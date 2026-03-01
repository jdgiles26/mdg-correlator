from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Federated Mission Data Grid"

    database_url: str
    nats_url: str = "nats://nats:4222"

    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "mission-objects"

    mediamtx_hls_base: str = "http://localhost:8888"

    enable_embeddings: bool = False

    class Config:
        env_prefix = ""
        case_sensitive = False

settings = Settings()
