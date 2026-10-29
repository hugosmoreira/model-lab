/**
 * The name people see: app chrome, the CLI banner and every exported share
 * card. Change it here, not at the call sites.
 *
 * Internal identifiers keep the `model-lab` slug on purpose — package names,
 * MODEL_LAB_* settings, store keys, the SQLite filename and the
 * `model-lab-replay` bundle format — so existing workspaces, .env files and
 * replay bundles keep working.
 */
export const BRAND_NAME = "HugoLabs";

/** Two letters in the gradient tile (nav and share-card header). */
export const BRAND_MARK = "HL";

/** Printed in every share card header, so an image carries its source. */
export const BRAND_HANDLE = "@hugolabs";
