<script lang="ts">
import { getStealthAddy } from '$lib/stealth/prepare-keys'
import * as secp256k1 from '@noble/curves/secp256k1.js'

const props = $props<{
    stealthMetaAddressURI: string
}>()

let generatedStealthAddress = $state<string | null>(null)

const generateStealthAddy = async () => {
    if (!props.stealthMetaAddressURI) return
    const ephemeralPrivateKey = secp256k1.secp256k1.utils.randomSecretKey()
    const stealthAddy = await getStealthAddy(props.stealthMetaAddressURI, ephemeralPrivateKey)

    generatedStealthAddress = stealthAddy.stealthAddress
}

</script>
    
<main>
    <p> We could find a stealth address for you!    
        <br />
        <br />
        Your stealth address is: <b></b>{props.stealthMetaAddressURI}
    </p>

    {#if generatedStealthAddress}
        <p>
            Your stealth address is: <b>{generatedStealthAddress}</b>
        </p>

    {/if}
    <button onclick={generateStealthAddy}>Generate Stealth Address</button>
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
</style>