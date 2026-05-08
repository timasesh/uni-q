from datetime import datetime, timezone


def get_timestamp() -> datetime:
    """
    Возвращает текущий UTC timestamp.
    Используется внутри Message для установки времени события.
    """
    return datetime.now(timezone.utc)
