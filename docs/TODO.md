# TODO

## Stream Coordinator / Platform Abstraction

- `stream_coordinator.py` is currently coupled directly to Discord (`discord.abc.Messageable`, `channel.send()`, `current_msg.edit()`). The event processing logic (filtering, block tracking, buffering) and the Discord I/O (sending/editing messages, rate limiting) should be separated so the coordinator can work with other output targets (Slack, terminal, etc.) via an abstract output sink.
- Tool display policy (transient indicators, suppressed results, thread archiving) is hardcoded in the coordinator rather than driven by the formatter. The formatter should expose a `tool_render_mode()` (`INLINE` vs `TRANSIENT`) and `format_tool_archive()` (returns `None` to skip) so each platform controls its own tool UX — e.g. Slack could show tools inline with no thread, Discord keeps transient indicators + thread.
