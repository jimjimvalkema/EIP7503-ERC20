// domain separators
pub global BURN_ADDRESS_TYPE: Field = 0x5a4b574f524d484f4c45; // UTF8("ZKWORMHOLE").toHex() [...new TextEncoder().encode("ZKWORMHOLE")].map(b=>b.toString(16)).join('')
pub global TOTAL_BURNED_DOMAIN: Field = 0x544f54414c5f4255524e4544; // UTF8("TOTAL_BURNED").toHex()
pub global TOTAL_SPENT_DOMAIN: Field = 0x544f54414c5f5350454e44; // UTF8("TOTAL_SPEND").toHex()