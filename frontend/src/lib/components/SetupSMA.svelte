<script lang="ts">

import { connectedAccount, currentProvider, signMessage } from '$lib/providers'
import { getStealthMetaAddress } from '$lib/stealth/prepare-keys'
import { recoverPublicKey, stringToHex, toHex, type Hex } from 'viem';
  import ResolveStealthAddy from './ResolveStealthAddy.svelte';

let spendingKey: string | null = null
let viewingKey: string | null = null

let spendingPublicKey: string | null = null
let viewingPublicKey: string | null = null

let userPublicKey: string | null = null

let isCreated = $state(false);

const generateStealthMetaAddress = async (message: string = "Stealth Meta Address") => {
    if (!$connectedAccount) {
        console.error('No account connected')
        return
    }

    if (!$currentProvider) {
        console.error('No provider available')
        return
    }

    const signature = await signMessage(message, $connectedAccount, $currentProvider)

    const publicKey = await recoverPublicKey({
        hash: stringToHex(message),
        signature: signature as Hex
    })

    try {
        const result = await getStealthMetaAddress(toHex(signature), message)

        spendingKey = toHex(result.spendingKey)
        viewingKey = toHex(result.viewingKey)
        spendingPublicKey = result.spendingPublicKey
        viewingPublicKey = result.viewingPublicKey
        userPublicKey = publicKey

        isCreated = true
    } catch (error) {
        console.error('Error generating stealth meta address:', error)
        throw error
    }
}

// remove 0x from the beginning of the second key
const stealthMetaAddressURI = $derived(viewingPublicKey && spendingPublicKey ? `st:eth:${viewingPublicKey}${spendingPublicKey.replace('0x', '')}` : null)

</script>

<main>
    <h1>Setup your Stealth Meta Address</h1>
    
    <p>
        On this screen you are going to generate your stealth meta address from the ERC-712 signature of your public key.
    </p>

    {#if isCreated}
        <p>
            Your user public key is: {userPublicKey}
            <br />
            Your spending public key is: {spendingPublicKey}
            <br />
            Your viewing public key is: {viewingPublicKey}
            <br />
            <br />
        </p>

        <p>
            <b>Private keys 😎</b>
            <br />
            Your spending key is: {spendingKey}
            <br />
            Your viewing key is: {viewingKey}
        </p>

        {#if stealthMetaAddressURI}
            <div class="flex flex-row gap-2">
                <ResolveStealthAddy stealthMetaAddressURI={stealthMetaAddressURI} />
            </div>
        {/if}
    {/if}

    {#if !isCreated}
        <p>
            Now you are going to sign a message
        </p>
        
        <button onclick={generateStealthMetaAddress}>Generate Stealth Meta Address</button>
    {/if}

</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
</style>