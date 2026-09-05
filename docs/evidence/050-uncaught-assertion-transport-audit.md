# Uncaught assertion transport RED

Base: bootstrap `2f622dd7c6f70aef0bf080dcbfcdfe3c81afbd66`.
Read-only compiler audit; generated probes stay inside this checkout's `build`.

Environment: Windows x64 `10.0.26200.0`, Node `v22.14.0`.
Native compiler SHA-256:
`1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b`.

Run with inherited Windows `SetErrorMode(0x8003)` to prevent assertion failures
opening interactive crash dialogs:

```powershell
node tools/audit-runtime-assertion-transport.mjs
```

Exit `1`, wall time 0.8974 s. This RED detects loss of authored message bytes;
it does not define a new stderr formatter. No assertion/timeout gate changed.

The probe compiles once per caught/uncaught variant, then supplies either `bad`
or `ok` through stdin. The function executes these assertions in order:

```vkf
check(value:str) -> bit:
    (value = "ok")?! "first assertion"
    false?! "second assertion"
```

| Variant | Runtime input | Exit | stdout | stderr |
| --- | --- | ---: | --- | --- |
| Uncaught | `bad` | 3 | empty | empty |
| Uncaught | `ok` | 3 | empty | empty |
| Caught and message bound | `bad` | 0 | `first assertion\r\n` | empty |
| Caught and message bound | `ok` | 0 | `second assertion\r\n` | empty |

Exact identities:

- Uncaught source: `ef8379b25045cf07a4e9c18b2cbe0796f2f7d9d5587defcad1cf094af1a35f35`
- Uncaught executable: `9f4aae6cf5501d80da775e23612d32c3418fe22ae2a33b86d4d45bccb2f4c2cc`
- Caught source: `ac0d7c64d529bf0b08a1d03802c8f21c478dae2438efde0068a74d798bdbbfe7`
- Caught executable: `53aa682c1eb6fc98613ab4159ebf10480232c656119bf0c6c5949f5a589f160d`

The x64 callee propagates pointer/length/type to callers, but an unhandled error
at the entry calls runtime slot 10 (`abort`) without rendering its message.
See `docs/plans/uncaught-assertion-diagnostic.md` for the complete source trace
and one pending user-visible choice. No implementation was attempted because
the current native path provides no exact uncaught-format contract to reuse.

These controls prove this sequential assertion ordering only, not every error
path or argument-evaluation order. The driver, compiler artifacts, public ABI,
pending EQ token, and I240 seed gate are unchanged. No bootstrap percentage is
promoted by the audit.
