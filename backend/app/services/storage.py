"""
Object storage service for files (S3-compatible or local)
"""
import os
from typing import Optional, BinaryIO
from app.config import settings
import boto3
from botocore.exceptions import ClientError


class StorageService:
    """Unified storage interface for S3-compatible or local storage"""
    
    def __init__(self):
        self.use_local = settings.USE_LOCAL_STORAGE
        
        if not self.use_local and settings.S3_ENDPOINT:
            self.s3_client = boto3.client(
                's3',
                endpoint_url=settings.S3_ENDPOINT,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY
            )
            self.bucket = settings.S3_BUCKET
        else:
            # Local storage
            self.storage_path = settings.LOCAL_STORAGE_PATH
            os.makedirs(self.storage_path, exist_ok=True)
            self.s3_client = None
    
    def upload_file(
        self,
        file_path: str,
        object_name: str,
        bucket: Optional[str] = None
    ) -> bool:
        """Upload a file to storage"""
        if self.use_local:
            return self._upload_local(file_path, object_name)
        else:
            return self._upload_s3(file_path, object_name, bucket)
    
    def download_file(
        self,
        object_name: str,
        local_path: str,
        bucket: Optional[str] = None
    ) -> bool:
        """Download a file from storage"""
        if self.use_local:
            return self._download_local(object_name, local_path)
        else:
            return self._download_s3(object_name, local_path, bucket)
    
    def delete_file(
        self,
        object_name: str,
        bucket: Optional[str] = None
    ) -> bool:
        """Delete a file from storage"""
        if self.use_local:
            return self._delete_local(object_name)
        else:
            return self._delete_s3(object_name, bucket)
    
    def _upload_local(self, file_path: str, object_name: str) -> bool:
        """Upload to local storage"""
        try:
            dest_path = os.path.join(self.storage_path, object_name)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            
            with open(file_path, 'rb') as src, open(dest_path, 'wb') as dst:
                dst.write(src.read())
            return True
        except Exception as e:
            print(f"Error uploading locally: {e}")
            return False
    
    def _upload_s3(
        self,
        file_path: str,
        object_name: str,
        bucket: Optional[str] = None
    ) -> bool:
        """Upload to S3-compatible storage"""
        if not self.s3_client:
            return False
        
        try:
            bucket_name = bucket or self.bucket
            self.s3_client.upload_file(file_path, bucket_name, object_name)
            return True
        except ClientError as e:
            print(f"Error uploading to S3: {e}")
            return False
    
    def _download_local(self, object_name: str, local_path: str) -> bool:
        """Download from local storage"""
        try:
            src_path = os.path.join(self.storage_path, object_name)
            if not os.path.exists(src_path):
                return False
            
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(src_path, 'rb') as src, open(local_path, 'wb') as dst:
                dst.write(src.read())
            return True
        except Exception as e:
            print(f"Error downloading locally: {e}")
            return False
    
    def _download_s3(
        self,
        object_name: str,
        local_path: str,
        bucket: Optional[str] = None
    ) -> bool:
        """Download from S3-compatible storage"""
        if not self.s3_client:
            return False
        
        try:
            bucket_name = bucket or self.bucket
            self.s3_client.download_file(bucket_name, object_name, local_path)
            return True
        except ClientError as e:
            print(f"Error downloading from S3: {e}")
            return False
    
    def _delete_local(self, object_name: str) -> bool:
        """Delete from local storage"""
        try:
            file_path = os.path.join(self.storage_path, object_name)
            if os.path.exists(file_path):
                os.remove(file_path)
            return True
        except Exception as e:
            print(f"Error deleting locally: {e}")
            return False
    
    def _delete_s3(
        self,
        object_name: str,
        bucket: Optional[str] = None
    ) -> bool:
        """Delete from S3-compatible storage"""
        if not self.s3_client:
            return False
        
        try:
            bucket_name = bucket or self.bucket
            self.s3_client.delete_object(Bucket=bucket_name, Key=object_name)
            return True
        except ClientError as e:
            print(f"Error deleting from S3: {e}")
            return False
