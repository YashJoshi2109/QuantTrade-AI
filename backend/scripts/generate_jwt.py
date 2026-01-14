"""
Generate a JWT token for testing purposes
"""
import sys
import os
from datetime import datetime, timedelta
import jwt

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings

def generate_test_token(user_id: int = 1, expires_days: int = 7) -> str:
    """Generate a test JWT token"""
    from datetime import timezone
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=expires_days)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "iat": now
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
    return token

def decode_token(token: str) -> dict:
    """Decode and verify a JWT token"""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        return {"error": "Token expired"}
    except jwt.InvalidTokenError as e:
        return {"error": f"Invalid token: {str(e)}"}

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate JWT token for testing")
    parser.add_argument("--user-id", type=int, default=1, help="User ID (default: 1)")
    parser.add_argument("--expires-days", type=int, default=7, help="Expiration in days (default: 7)")
    parser.add_argument("--decode", type=str, help="Decode a token instead of generating")
    
    args = parser.parse_args()
    
    if args.decode:
        # Decode existing token
        print("\n🔓 Decoding JWT Token:")
        print("=" * 60)
        decoded = decode_token(args.decode)
        if "error" in decoded:
            print(f"❌ Error: {decoded['error']}")
        else:
            print(f"✅ Token is valid!")
            print(f"\n📋 Payload:")
            print(f"   User ID: {decoded.get('sub')}")
            print(f"   Issued At: {datetime.fromtimestamp(decoded.get('iat', 0)).isoformat()}")
            print(f"   Expires At: {datetime.fromtimestamp(decoded.get('exp', 0)).isoformat()}")
            print(f"\n📄 Full payload:")
            for key, value in decoded.items():
                print(f"   {key}: {value}")
    else:
        # Generate new token
        token = generate_test_token(args.user_id, args.expires_days)
        
        print("\n🔑 Generated JWT Token:")
        print("=" * 60)
        print(token)
        print("\n" + "=" * 60)
        print(f"\n📋 Token Details:")
        print(f"   User ID: {args.user_id}")
        print(f"   Expires in: {args.expires_days} days")
        print(f"   Secret Key: {settings.SECRET_KEY[:20]}...")
        print(f"\n💡 Usage:")
        print(f"   curl -H 'Authorization: Bearer {token[:50]}...' http://localhost:8000/api/v1/auth/me")
        print(f"\n🔍 Decode this token:")
        print(f"   python scripts/generate_jwt.py --decode '{token}'")
