/**
 * Verifiable Documents (F1): deterministic content hashing so a document can
 * carry a tamper-evident QR / short code.
 */
export { sha256Hex } from './sha256';
export { canonicalize } from './canonical';
export {
  VERIFY_VERSION,
  hashDocument,
  verifyDocument,
  type VerifyInput,
  type DocumentHash,
} from './verify';
