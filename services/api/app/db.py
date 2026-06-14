from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .settings import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

try:
    from pgvector.psycopg import register_vector
except ImportError:  # pragma: no cover - optional during dependency bootstrap
    register_vector = None


if register_vector is not None:
    @event.listens_for(engine, "connect")
    def _register_pgvector(dbapi_connection, _connection_record):
        try:
            register_vector(dbapi_connection)
        except Exception:
            pass

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
