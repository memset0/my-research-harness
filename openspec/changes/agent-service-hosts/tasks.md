## 1. Implementation

- [x] 1.1 `ServicePort` (integer or `{host, port}`), load-time validation, upstream address and dial timeout; advertise `service-hosts-v1`
- [x] 1.2 Go tests: config forms and refusals, forwarding to a configured host, unreachable host answers 503
- [x] 1.3 README: host-qualified `servicePorts`

## 2. Deployment check

- [ ] 2.1 A deployed agent forwards its service ports to compute-node dashboards without local proxies
