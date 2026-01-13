"""
ML models for risk scoring and sentiment analysis
"""
import numpy as np
import pandas as pd
from typing import Dict, List, Optional
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
import shap


class RiskScoringModel:
    """Risk scoring model using ensemble methods"""
    
    def __init__(self):
        self.model = GradientBoostingRegressor(n_estimators=100, random_state=42)
        self.scaler = StandardScaler()
        self.feature_names = [
            'volatility', 'beta', 'max_drawdown', 'momentum',
            'volume_ratio', 'rsi', 'macd_signal'
        ]
        self.is_trained = False
    
    def prepare_features(self, data: pd.DataFrame) -> np.ndarray:
        """Prepare features from market data"""
        features = []
        for feature in self.feature_names:
            if feature in data.columns:
                features.append(data[feature].values)
            else:
                features.append(np.zeros(len(data)))
        return np.column_stack(features)
    
    def train(self, X: pd.DataFrame, y: np.ndarray):
        """Train the risk scoring model"""
        X_scaled = self.scaler.fit_transform(self.prepare_features(X))
        self.model.fit(X_scaled, y)
        self.is_trained = True
    
    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Predict risk scores"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        X_scaled = self.scaler.transform(self.prepare_features(X))
        return self.model.predict(X_scaled)
    
    def explain(self, X: pd.DataFrame, top_n: int = 5) -> Dict:
        """Explain predictions using SHAP"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        
        X_scaled = self.scaler.transform(self.prepare_features(X))
        explainer = shap.TreeExplainer(self.model)
        shap_values = explainer.shap_values(X_scaled)
        
        # Get feature importance for the first sample
        feature_importance = {
            self.feature_names[i]: float(shap_values[0][i])
            for i in range(len(self.feature_names))
        }
        
        # Sort by absolute importance
        sorted_features = sorted(
            feature_importance.items(),
            key=lambda x: abs(x[1]),
            reverse=True
        )[:top_n]
        
        return {
            "top_factors": dict(sorted_features),
            "prediction": float(self.model.predict(X_scaled)[0])
        }


class SentimentClassifier:
    """Simple sentiment classifier for news/articles"""
    
    def __init__(self):
        self.model = RandomForestClassifier(n_estimators=100, random_state=42)
        self.is_trained = False
    
    def train(self, X: np.ndarray, y: np.ndarray):
        """Train sentiment classifier"""
        self.model.fit(X, y)
        self.is_trained = True
    
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict sentiment (0: Bearish, 1: Neutral, 2: Bullish)"""
        if not self.is_trained:
            # Fallback to rule-based if not trained
            return self._rule_based_sentiment(X)
        return self.model.predict(X)
    
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Get sentiment probabilities"""
        if not self.is_trained:
            return self._rule_based_sentiment_proba(X)
        return self.model.predict_proba(X)
    
    def _rule_based_sentiment(self, X: np.ndarray) -> np.ndarray:
        """Simple rule-based sentiment as fallback"""
        # This is a placeholder - would use actual text features
        return np.array([1] * len(X))  # Default to Neutral
    
    def _rule_based_sentiment_proba(self, X: np.ndarray) -> np.ndarray:
        """Rule-based sentiment probabilities"""
        # Placeholder
        return np.array([[0.2, 0.6, 0.2]] * len(X))
