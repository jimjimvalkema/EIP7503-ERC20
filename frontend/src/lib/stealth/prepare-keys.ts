import { hashMessage, hexToBytes, toHex, type Signature } from 'viem'
import * as secp256k1 from '@noble/curves/secp256k1.js';
import type { HexString } from '@scopelift/stealth-address-sdk/dist/utils/crypto/types';

/**
 * Normalize private key to ensure it's a valid secp256k1 private key
 */
async function normalizePrivateKey(keyMaterial: Uint8Array): Promise<Uint8Array> {
    // Ensure the key is exactly 32 bytes
    if (keyMaterial.length !== 32) {
      throw new Error('Private key must be exactly 32 bytes');
    }
  
    // Use secp256k1 library to validate the private key
    try {
      // Try to generate a public key - this will throw if the private key is invalid
      secp256k1.secp256k1.getPublicKey(keyMaterial, true);
      return keyMaterial;
    } catch (error) {
      // If key is invalid, hash it until we get a valid one
      const hashedKey = await crypto.subtle.digest('SHA-256', new Uint8Array(keyMaterial));
      return normalizePrivateKey(new Uint8Array(hashedKey));
    }
  }

/**
 * Derive spending and viewing keys from WebAuthn signature using HKDF
 * Following EIP-5564 key derivation patterns
 */
export const deriveStealthKeys = async (signature: Uint8Array, staticMessage: string): Promise<{spendingKey: Uint8Array, viewingKey: Uint8Array}> => {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(signature),
      'HKDF',
      false,
      ['deriveKey', 'deriveBits']
    );
  
    // Derive spending key using EIP-5564 compliant salt and info
    const spendingKeyMaterial = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('EIP-5564-spending-key'),
        info: new TextEncoder().encode(`${staticMessage}-spending`),
      },
      keyMaterial,
      256 // 32 bytes
    );
  
    // Derive viewing key using EIP-5564 compliant salt and info
    const viewingKeyMaterial = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('EIP-5564-viewing-key'),
        info: new TextEncoder().encode(`${staticMessage}-viewing`),
      },
      keyMaterial,
      256 // 32 bytes
    );
  
    // Ensure private keys are valid secp256k1 private keys
    const spendingKey = await normalizePrivateKey(new Uint8Array(spendingKeyMaterial));
    const viewingKey = await normalizePrivateKey(new Uint8Array(viewingKeyMaterial));
  
    return {
      spendingKey,
      viewingKey,
    };
  }

export const getStealthMetaAddress = async (signature: HexString, staticMessage: string = "Stealth Meta Address") => {
    const { spendingKey, viewingKey } = await deriveStealthKeys(Uint8Array.from(hexToBytes(signature)), staticMessage);

    return {
        spendingKey,
        viewingKey,
        spendingPublicKey: toHex(secp256k1.secp256k1.getPublicKey(spendingKey, true)),
        viewingPublicKey: toHex(secp256k1.secp256k1.getPublicKey(viewingKey, true)),
    }

}

