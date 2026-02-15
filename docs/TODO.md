# TODO

## Stream Coordinator / Platform Abstraction

- `stream_coordinator.py` is currently coupled directly to Discord (`discord.abc.Messageable`, `channel.send()`, `current_msg.edit()`). The event processing logic (filtering, block tracking, buffering) and the Discord I/O (sending/editing messages, rate limiting) should be separated so the coordinator can work with other output targets (Slack, terminal, etc.) via an abstract output sink.
