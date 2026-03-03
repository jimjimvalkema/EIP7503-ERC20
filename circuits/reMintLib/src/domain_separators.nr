// domain separators
pub global BURN_ADDRESS_TYPE: Field = 0x5a4b574f524d484f4c45;           // UTF8("ZKWORMHOLE").toHex() [...new TextEncoder().encode("ZKWORMHOLE")].map(b=>b.toString(16)).join('')
pub global TOTAL_BURNED_DOMAIN: Field = 0x544f54414c5f4255524e4544;     // UTF8("TOTAL_BURNED").toHex()
pub global TOTAL_MINTED: Field = 0x544f54414c5f4d494e544544;            // UTF8("TOTAL_MINTED").toHex()
pub global NULLIFIER: Field = 0x4e554c4c4946494552;                     // UTF8("NULLIFIER").toHex()
pub global FAKE_LEAF: Field = 0x46414b455f4c454146;                     // UTF8("FAKE_LEAF").toHex()
pub global FAKE_NULLIFIER: Field = 0x46414b455f4e554c4c4946494552;      // UTF8("FAKE_NULLIFIER").toHex()