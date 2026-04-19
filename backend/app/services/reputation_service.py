"""
Reputation calculation and update service for the QuantTrade community.

Tracks reputation-affecting actions and updates user reputation scores.
"""
import logging
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.community import Post, Comment, Vote, UserFollow

logger = logging.getLogger(__name__)


class ReputationService:
    """Calculate and update user reputation based on community activity."""

    POINTS = {
        "post_upvote_received": 10,
        "post_downvote_received": -2,
        "comment_upvote_received": 5,
        "comment_downvote_received": -1,
        "post_created": 2,
        "comment_created": 1,
        "follower_gained": 3,
        "follower_lost": -3,
        "post_removed_by_mod": -50,
        "ai_fact_check_passed": 15,
    }

    def calculate_reputation(self, user_id: int, db: Session) -> int:
        """Recalculate total reputation from scratch by summing all actions.

        This is an expensive operation intended for periodic reconciliation,
        not for every request. For normal flow use ``update_reputation``.
        """
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return 0

        total = 0

        # Points from posts created
        post_count = db.query(Post).filter(
            Post.author_id == user_id, Post.is_removed == False
        ).count()
        total += post_count * self.POINTS["post_created"]

        # Points from comments created
        comment_count = db.query(Comment).filter(
            Comment.author_id == user_id, Comment.is_removed == False
        ).count()
        total += comment_count * self.POINTS["comment_created"]

        # Points from upvotes received on posts
        post_upvotes = (
            db.query(Vote)
            .join(Post, (Vote.target_id == Post.id) & (Vote.target_type == "post"))
            .filter(Post.author_id == user_id, Vote.vote_type == 1)
            .count()
        )
        total += post_upvotes * self.POINTS["post_upvote_received"]

        # Points from downvotes received on posts
        post_downvotes = (
            db.query(Vote)
            .join(Post, (Vote.target_id == Post.id) & (Vote.target_type == "post"))
            .filter(Post.author_id == user_id, Vote.vote_type == -1)
            .count()
        )
        total += post_downvotes * self.POINTS["post_downvote_received"]

        # Points from upvotes received on comments
        comment_upvotes = (
            db.query(Vote)
            .join(Comment, (Vote.target_id == Comment.id) & (Vote.target_type == "comment"))
            .filter(Comment.author_id == user_id, Vote.vote_type == 1)
            .count()
        )
        total += comment_upvotes * self.POINTS["comment_upvote_received"]

        # Points from downvotes received on comments
        comment_downvotes = (
            db.query(Vote)
            .join(Comment, (Vote.target_id == Comment.id) & (Vote.target_type == "comment"))
            .filter(Comment.author_id == user_id, Vote.vote_type == -1)
            .count()
        )
        total += comment_downvotes * self.POINTS["comment_downvote_received"]

        # Points from followers
        follower_count = db.query(UserFollow).filter(
            UserFollow.following_id == user_id
        ).count()
        total += follower_count * self.POINTS["follower_gained"]

        # Penalty for mod-removed posts
        removed_count = db.query(Post).filter(
            Post.author_id == user_id, Post.is_removed == True
        ).count()
        total += removed_count * self.POINTS["post_removed_by_mod"]

        # Persist
        user.reputation = total
        db.commit()

        return total

    def update_reputation(self, user_id: int, action_type: str, db: Session) -> int:
        """Increment/decrement reputation based on a single action.

        Returns the new reputation value.
        """
        delta = self.POINTS.get(action_type, 0)
        if delta == 0:
            return 0

        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return 0

        user.reputation = (user.reputation or 0) + delta
        db.commit()

        return user.reputation


# Module-level singleton for easy import
reputation_service = ReputationService()
