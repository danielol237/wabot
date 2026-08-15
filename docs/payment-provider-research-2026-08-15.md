# Cameroon Payment Provider Research — 15 August 2026

## MTN MoMo

Source: [MTN MoMo API](https://momo.mtn.com/api/)

The official MTN page says the MoMo API supports fintech, e-commerce, payments, and collections. It explicitly lists Collection for remote automatic collection of bills, fees, and taxes; Disbursement; Collection Widget for website payments by QR code; and Remittances. The page links developers to the official MoMo Developer Portal at `https://momodeveloper.mtn.com/` and exposes tutorials covering sandbox-user creation, API-key generation, RequestToPay, transaction status, account balance, and user status.

Implementation consequence: ARIA should model MTN as a collection provider with a sandbox onboarding state, request-to-pay creation, transaction-status polling, idempotent provider-reference handling, and a verified callback/status reconciliation path. Credentials and merchant configuration must remain server-side. The current ARIA adapter remains sandbox-only until Cameroon-specific product availability, merchant onboarding, callback details, and production credentials are configured in the official portal.

## Orange Money

Source: [Orange Money Web Payment / M Payment API — Overview](https://developer.orange.com/apis/om-webpay)

The official Orange Developer page identifies the Orange Money Web Payment / M Payment API and includes an `Apply for Orange Money` onboarding path. The search result for this official page states that the Web Payment service is available to merchants starting with Cameroon and several other markets.

Implementation consequence: ARIA should model Orange as a web-payment provider with merchant onboarding, payment-session creation, provider-reference persistence, notification/callback verification, and explicit reconciliation of pending/succeeded/failed states. The current ARIA adapter must not claim production support until the official Orange developer account, Cameroon merchant contract, sandbox credentials, and callback requirements are confirmed.

## Architecture decision

The first production implementation will remain provider-neutral and sandbox-first. It will not guess undocumented endpoints, signature headers, or callback formats. The platform payment contract already supports payment intents, provider status, idempotent webhook records, and HMAC verification; provider-specific adapters will be added only from the official technical documentation obtained after merchant onboarding.

## References

1. [MTN MoMo API — official product and developer overview](https://momo.mtn.com/api/)
2. [Orange Money Web Payment / M Payment API — official overview](https://developer.orange.com/apis/om-webpay)
3. [MTN MoMo Developer Portal](https://momodeveloper.mtn.com/)

## MTN developer portal verification

The official [MTN MoMo Developer Portal](https://momodeveloper.mtn.com/products) identifies itself as a test environment and exposes separate links for Documentation, API Sandbox, Products, Support, Sign in, and Sign up. The official documentation index is available at [momodeveloper.mtn.com/api-documentation](https://momodeveloper.mtn.com/api-documentation), and the portal also exposes an API Sandbox route.

Implementation consequence: the ARIA provider adapter should distinguish sandbox and production base URLs, keep sandbox credentials separate, and require explicit operator configuration before enabling a live provider. The provider-neutral payment contract is appropriate while the exact Cameroon-specific product subscription and callback details remain tied to the authenticated merchant account.
