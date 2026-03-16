from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    allowed_origins: str = "*"
    rate_limit_per_minute: int = 30
    session_ttl_minutes: int = 30
    max_sessions: int = 1000
    max_text_length: int = 50000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
