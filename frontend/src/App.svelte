<script lang="ts">
  import "./app.css";
  import WalletConnect from "./lib/components/WalletConnect.svelte";
  import MessageSigner from "./lib/components/MessageSigner.svelte";
  import TypedDataSigner from "./lib/components/TypedDataSigner.svelte";
  import ERC7730Signer from "./lib/components/ERC7730Signer.svelte";
  import SetupSMA from "./lib/components/SetupSMA.svelte";
</script>

<main>
  <h1>Swarzschild - Wallet Integration Demo</h1>

  <div class="card">
    <SetupSMA />
  </div>

  <div class="card">
    <WalletConnect />
  </div>

  <div class="card">
    <MessageSigner />
  </div>

  <div class="card">
    <TypedDataSigner />
  </div>

  <div class="card">
    <ERC7730Signer />
  </div>
</main>

<style>
</style>
