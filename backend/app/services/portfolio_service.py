"""
Portfolio management service for tracking holdings and performance
"""
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.portfolio import Portfolio, Position, Transaction, TransactionType, PortfolioSnapshot
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.models.realtime_quote import RealtimeQuote
from app.services.enhanced_data_fetcher import EnhancedDataFetcher


class PortfolioService:
    """Service for managing user portfolios and calculating performance"""
    
    @staticmethod
    def create_portfolio(db: Session, user_id: int, name: str, initial_cash: float = 100000.0) -> Portfolio:
        """Create new portfolio for user"""
        portfolio = Portfolio(
            user_id=user_id,
            name=name,
            initial_cash=initial_cash,
            cash_balance=initial_cash,
            is_paper_trading=1
        )
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)
        return portfolio
    
    @staticmethod
    def execute_trade(
        db: Session,
        portfolio_id: int,
        symbol: str,
        transaction_type: TransactionType,
        quantity: float,
        price: Optional[float] = None,
        fees: float = 0.0,
        notes: Optional[str] = None
    ) -> Transaction:
        """
        Execute a trade (BUY or SELL)
        Updates position and cash balance automatically
        """
        portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        if not portfolio:
            raise ValueError("Portfolio not found")
        
        # Get symbol
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if not db_symbol:
            raise ValueError(f"Symbol {symbol} not found")
        
        # Get current price if not provided
        if price is None:
            quote_data = EnhancedDataFetcher.fetch_realtime_quote(symbol, db)
            price = quote_data.get('last_price', 0)
            if price == 0:
                raise ValueError(f"Cannot fetch price for {symbol}")
        
        total_amount = (quantity * price) + fees
        
        # Validate transaction
        if transaction_type == TransactionType.BUY:
            if portfolio.cash_balance < total_amount:
                raise ValueError(f"Insufficient funds. Need ${total_amount:.2f}, have ${portfolio.cash_balance:.2f}")
            
            # Update cash
            portfolio.cash_balance -= total_amount
            
            # Update or create position
            position = db.query(Position).filter(
                Position.portfolio_id == portfolio_id,
                Position.symbol_id == db_symbol.id
            ).first()
            
            if position:
                # Update average cost basis
                total_cost = (position.avg_cost_basis * position.quantity) + (price * quantity)
                position.quantity += quantity
                position.avg_cost_basis = total_cost / position.quantity
            else:
                # Create new position
                position = Position(
                    portfolio_id=portfolio_id,
                    symbol_id=db_symbol.id,
                    quantity=quantity,
                    avg_cost_basis=price,
                    current_price=price
                )
                db.add(position)
        
        elif transaction_type == TransactionType.SELL:
            position = db.query(Position).filter(
                Position.portfolio_id == portfolio_id,
                Position.symbol_id == db_symbol.id
            ).first()
            
            if not position or position.quantity < quantity:
                raise ValueError(f"Insufficient shares to sell. Have {position.quantity if position else 0}, trying to sell {quantity}")
            
            # Calculate realized P&L
            realized_pnl = (price - position.avg_cost_basis) * quantity - fees
            
            # Update position
            position.quantity -= quantity
            
            # Update cash
            portfolio.cash_balance += (quantity * price) - fees
            
            # Remove position if quantity is 0
            if position.quantity == 0:
                db.delete(position)
        
        else:
            raise ValueError(f"Unsupported transaction type: {transaction_type}")
        
        # Create transaction record
        transaction = Transaction(
            portfolio_id=portfolio_id,
            symbol_id=db_symbol.id,
            transaction_type=transaction_type,
            quantity=quantity,
            price=price,
            total_amount=total_amount,
            fees=fees,
            notes=notes,
            transaction_date=datetime.utcnow(),
            realized_pnl=realized_pnl if transaction_type == TransactionType.SELL else None
        )
        db.add(transaction)
        
        db.commit()
        db.refresh(transaction)
        
        # Update portfolio positions with latest prices
        PortfolioService.update_portfolio_values(db, portfolio_id)
        
        return transaction
    
    @staticmethod
    def update_portfolio_values(db: Session, portfolio_id: int):
        """Update all positions with current prices and calculate P&L"""
        positions = db.query(Position).filter(Position.portfolio_id == portfolio_id).all()
        
        for position in positions:
            # Get latest price
            quote = db.query(RealtimeQuote).filter(
                RealtimeQuote.symbol_id == position.symbol_id
            ).first()
            
            if quote:
                position.current_price = quote.last_price
            else:
                # Fallback to latest price bar
                latest_bar = db.query(PriceBar).filter(
                    PriceBar.symbol_id == position.symbol_id
                ).order_by(PriceBar.timestamp.desc()).first()
                
                if latest_bar:
                    position.current_price = latest_bar.close
            
            # Calculate metrics
            if position.current_price:
                position.market_value = position.quantity * position.current_price
                position.unrealized_pnl = (position.current_price - position.avg_cost_basis) * position.quantity
                if position.avg_cost_basis > 0:
                    position.unrealized_pnl_percent = (position.unrealized_pnl / (position.avg_cost_basis * position.quantity)) * 100
        
        db.commit()
    
    @staticmethod
    def get_portfolio_summary(db: Session, portfolio_id: int) -> Dict:
        """Get comprehensive portfolio summary"""
        portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        if not portfolio:
            raise ValueError("Portfolio not found")
        
        # Update values first
        PortfolioService.update_portfolio_values(db, portfolio_id)
        
        # Get all positions
        positions = db.query(Position).filter(Position.portfolio_id == portfolio_id).all()
        
        # Calculate totals
        total_invested = sum((p.avg_cost_basis * p.quantity) for p in positions)
        total_market_value = sum((p.market_value or 0) for p in positions)
        total_unrealized_pnl = sum((p.unrealized_pnl or 0) for p in positions)
        
        # Get realized P&L from closed transactions
        realized_pnl = db.query(func.sum(Transaction.realized_pnl)).filter(
            Transaction.portfolio_id == portfolio_id,
            Transaction.transaction_type == TransactionType.SELL
        ).scalar() or 0.0
        
        total_value = portfolio.cash_balance + total_market_value
        total_pnl = total_unrealized_pnl + realized_pnl
        total_return_pct = ((total_value - portfolio.initial_cash) / portfolio.initial_cash * 100) if portfolio.initial_cash > 0 else 0
        
        # Position details
        position_details = []
        for pos in positions:
            symbol = db.query(Symbol).filter(Symbol.id == pos.symbol_id).first()
            position_details.append({
                "symbol": symbol.symbol if symbol else "",
                "quantity": pos.quantity,
                "avg_cost": pos.avg_cost_basis,
                "current_price": pos.current_price,
                "market_value": pos.market_value,
                "unrealized_pnl": pos.unrealized_pnl,
                "unrealized_pnl_percent": pos.unrealized_pnl_percent,
                "weight": (pos.market_value / total_value * 100) if total_value > 0 else 0
            })
        
        return {
            "portfolio_id": portfolio_id,
            "name": portfolio.name,
            "cash_balance": portfolio.cash_balance,
            "total_invested": total_invested,
            "total_market_value": total_market_value,
            "total_value": total_value,
            "unrealized_pnl": total_unrealized_pnl,
            "realized_pnl": realized_pnl,
            "total_pnl": total_pnl,
            "total_return_percent": total_return_pct,
            "positions": position_details,
            "position_count": len(positions)
        }
    
    @staticmethod
    def create_snapshot(db: Session, portfolio_id: int) -> PortfolioSnapshot:
        """Create daily snapshot for performance tracking"""
        summary = PortfolioService.get_portfolio_summary(db, portfolio_id)
        portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
        
        # Check if snapshot already exists for today
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        existing = db.query(PortfolioSnapshot).filter(
            PortfolioSnapshot.portfolio_id == portfolio_id,
            PortfolioSnapshot.snapshot_date >= today
        ).first()
        
        if existing:
            return existing
        
        # Get previous snapshot for daily return calculation
        prev_snapshot = db.query(PortfolioSnapshot).filter(
            PortfolioSnapshot.portfolio_id == portfolio_id
        ).order_by(PortfolioSnapshot.snapshot_date.desc()).first()
        
        daily_return = 0.0
        daily_return_percent = 0.0
        
        if prev_snapshot:
            daily_return = summary['total_value'] - prev_snapshot.total_value
            if prev_snapshot.total_value > 0:
                daily_return_percent = (daily_return / prev_snapshot.total_value) * 100
        
        snapshot = PortfolioSnapshot(
            portfolio_id=portfolio_id,
            snapshot_date=datetime.utcnow(),
            total_value=summary['total_value'],
            cash_balance=summary['cash_balance'],
            invested_value=summary['total_market_value'],
            total_pnl=summary['total_pnl'],
            total_pnl_percent=summary['total_return_percent'],
            daily_return=daily_return,
            daily_return_percent=daily_return_percent
        )
        
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)
        return snapshot
