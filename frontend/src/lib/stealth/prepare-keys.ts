import { hashMessage, hexToBytes, toHex, type Signature } from 'viem'
import * as secp256k1 from '@noble/curves/secp256k1.js';
import type { HexString } from '@scopelift/stealth-address-sdk/dist/utils/crypto/types';
import { generateStealthAddress } from '@scopelift/stealth-address-sdk';

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

/**
 * Convert Uint8Array to hex string
 */
function arrayToHex(array: Uint8Array): string {
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const getStealthMetaAddress = async (signature: HexString, staticMessage: string = "Stealth Meta Address") => {
    const { spendingKey, viewingKey } = await deriveStealthKeys(Uint8Array.from(hexToBytes(signature)), staticMessage);

    const spendingPublicKey = secp256k1.secp256k1.getPublicKey(Uint8Array.from(spendingKey), true);
    const viewingPublicKey = secp256k1.secp256k1.getPublicKey(Uint8Array.from(viewingKey), true);

    return {
        spendingKey,
        viewingKey,
        spendingPublicKey: '0x' + arrayToHex(spendingPublicKey),
        viewingPublicKey: '0x' + arrayToHex(viewingPublicKey),
    }
}

export const getStealthAddy = async (stealthMetaAddressURI: string, ephemeralPrivateKey: Uint8Array) => {
  // 7 chars = st:eth:
  if (stealthMetaAddressURI.startsWith('st:eth:')) stealthMetaAddressURI = stealthMetaAddressURI.slice(7)

  const { ephemeralPublicKey, stealthAddress } = generateStealthAddress({ stealthMetaAddressURI });

  return {
    ephemeralPublicKey: toHex(ephemeralPublicKey),
    stealthAddress, // shared seccret 
  }

}

