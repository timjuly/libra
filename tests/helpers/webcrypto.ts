import { timingSafeEqual } from 'node:crypto';

// Node lacks this Workers extension. API tests also run on actual workerd with
// nodejs_compat disabled, exercising its native implementation independently.
if (!('timingSafeEqual' in crypto.subtle))
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { value: timingSafeEqual });
