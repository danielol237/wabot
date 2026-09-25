## 2026-09-25 - Avoid Dynamic RegExp Compilation in Hot Message Routing Paths
**Learning:** Re-instantiating `new RegExp()` inside array iterations during per-message classification (`needsRealtimeInfo`) adds unnecessary GC churn and execution latency in high-volume WhatsApp message processing pipelines. Simple `String.prototype.includes` substring checks perform faster while preserving exact classification semantics.
**Action:** Always prefer static regexes or native `String.prototype.includes` checks in hot per-message intent routing paths.
