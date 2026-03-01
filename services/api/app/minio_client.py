from minio import Minio
from .settings import settings

def get_minio() -> Minio:
    client = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )
    # Ensure bucket exists
    if not client.bucket_exists(settings.minio_bucket):
        client.make_bucket(settings.minio_bucket)
    return client
