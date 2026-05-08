from dataclasses import field
from typing import Optional, Set, Type, TypeVar, Union
from uuid import UUID, uuid4

from pendulum.datetime import DateTime
from pydantic import BaseModel
from pydantic import ConfigDict, ValidationError

from event_store.types import JSON
from .helpers import get_timestamp


class Message(BaseModel):
    """Base Message Implementation"""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    stream: str
    type: str
    data: JSON
    id: UUID = field(default_factory=uuid4)
    metadata: JSON = field(default_factory=dict)  # type: ignore
    position: int = 0
    global_position: int = 0
    time: Optional[DateTime] = None


T_MessageData = TypeVar("T_MessageData", bound="MessageData")


class MessageData(BaseModel):
    @classmethod
    def from_json(cls: Type[T_MessageData], data: JSON) -> T_MessageData:
        return cls.model_validate(data)

    @classmethod
    def from_event(cls: Type[T_MessageData], event: "MessageData") -> T_MessageData:
        data = event.to_json()
        data["timestamp"] = get_timestamp()
        return cls.from_json(data)

    def to_json(self) -> JSON:
        return self.model_dump(mode="json")


class Event(MessageData):
    pass


class Command(MessageData):
    pass


EventOrCommand = Union[Event, Command]


class WithTimestamp:
    timestamp: int


class BuildOptionalTypesFromMessageFactory:
    def __init__(self, expected_types: Set[Type[MessageData]]) -> None:
        self._expected_types = {t.__name__: t for t in expected_types}

    def create_from_message(self, message: Message) -> Optional[MessageData]:
        if message.type not in self._expected_types:
            return None
        try:
            return (self._expected_types[message.type]).from_json(message.data)
        except ValidationError:
            return None
