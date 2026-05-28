// =====================================================================
// apps/api/src/common/services/password.service.ts
// =====================================================================
// All password operations live here. No other module hashes, verifies,
// or generates passwords directly.
//
// Hashing: argon2id with OWASP-recommended params (configured via env)
// Generation: 16 chars from [A-Za-z0-9] excluding ambiguous OIl10
//             → ~92 bits of entropy, copy-pasteable, dictation-friendly
// =====================================================================

import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { randomInt } from "crypto";

import { env } from "@ibirdos/config";

// Ambiguous characters removed: 0/O, 1/I/l
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

@Injectable()
export class PasswordService {
  /**
   * Hash a plaintext password using argon2id with the configured
   * memory/time/parallelism cost. The salt is generated automatically
   * by argon2 and embedded in the resulting string.
   */
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, {
      type: argon2.argon2id,
      memoryCost: env.ARGON2_MEMORY_KIB,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });
  }

  /**
   * Verify a plaintext password against a stored hash. Constant-time
   * by virtue of argon2's verify; do NOT short-circuit on hash format
   * errors (they leak whether the account exists).
   */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // Malformed hash or argon2 internal error — treat as "wrong password".
      // Returning false here keeps the response identical to a genuine
      // password mismatch, denying the attacker information.
      return false;
    }
  }

  /**
   * Generate a cryptographically random password for a manager-created
   * user. The password is shown to the creator exactly once and never
   * stored in plaintext.
   *
   * 16 chars × log2(56) ≈ 92.8 bits — well above the NIST 80-bit
   * threshold for high-value credentials.
   */
  generate(length = 16): string {
    if (length < 12) throw new Error("Password length must be >= 12");
    let out = "";
    for (let i = 0; i < length; i++) {
      out += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
    }
    return out;
  }

  /**
   * Detect whether a stored hash needs upgrading because the cost
   * parameters have been raised. Call this opportunistically after
   * a successful login: if needsRehash() returns true, hash the
   * plaintext (which you still have in scope from the login attempt)
   * and update the stored hash.
   */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: env.ARGON2_MEMORY_KIB,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });
  }
}
