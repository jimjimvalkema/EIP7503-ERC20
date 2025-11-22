<script lang="ts">

import { connectedAccount, currentProvider, signMessage } from '$lib/providers'
import { getStealthMetaAddress } from '$lib/stealth/prepare-keys'
import { toHex } from 'viem';

let spendingKey: string | null = null
let viewingKey: string | null = null

let spendingPublicKey: string | null = null
let viewingPublicKey: string | null = null

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
    try {
        const result = await getStealthMetaAddress(toHex(signature), message)

        spendingKey = result.spendingKey
        viewingKey = result.viewingKey
        spendingPublicKey = result.spendingPublicKey
        viewingPublicKey = result.viewingPublicKey

        isCreated = true
    } catch (error) {
        console.error('Error generating stealth meta address:', error)
        throw error
    }
}

let isCreated = false;

</script>

<main>
    <h1>Setup your Stealth Meta Address</h1>
    
    <p>
        On this screen you are going to generate your stealth meta address from the ERC-712 signature of your public key.
    </p>

    {#if isCreated}
        <p>
            Your stealth meta address has been created
        </p>

        <p>
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