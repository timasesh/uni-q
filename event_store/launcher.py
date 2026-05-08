from abc import ABC, abstractmethod
from typing import Optional, Sequence

from db import DbSession
from event_store.message_store import MessageStore
from event_store.subscription import Subscription


class Launcher(ABC):
    message_store: MessageStore
    db_session: Optional[DbSession]
    subscriptions: Sequence[Subscription]

    def __init__(
        self,
        message_store: MessageStore,
        db_session: Optional[DbSession] = None,
    ) -> None:
        self.message_store = message_store
        self.db_session = db_session
        self.init_subscriptions()

    @abstractmethod
    def init_subscriptions(self) -> None:
        pass  # pragma: no cover

    @abstractmethod
    async def start(self) -> None:
        pass  # pragma: no cover

    @abstractmethod
    def stop(self) -> None:
        pass  # pragma: no cover
