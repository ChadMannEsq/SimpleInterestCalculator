# Simple Interest Calculator

A simple React-based calculator for computing interest schedules.

## Browser Requirements

This component attempts to use [`crypto.randomUUID`](https://developer.mozilla.org/docs/Web/API/Crypto/randomUUID) when generating IDs for new rows. Browsers without this API fall back to a basic `Math.random` implementation, which is not cryptographically secure. For the best experience, use a modern browser with `crypto.randomUUID` support.

