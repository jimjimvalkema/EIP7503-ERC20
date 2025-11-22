<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Alert, AlertTitle, AlertDescription } from "$lib/components/ui/alert";
  import WalletSearch from "$lib/components/flows/WalletSearch.svelte";
  import SendAmount from "$lib/components/flows/SendAmount.svelte";
  import SendTransaction from "$lib/components/flows/SendTransaction.svelte";
  import WalletHeader from "$lib/components/WalletHeader.svelte";
  import WalletConnectModal from "$lib/components/WalletConnectModal.svelte";
  import { router } from "$lib/store/router";
  import type { Address } from "viem";
  import { ArrowLeft, CheckCircle2 } from "@lucide/svelte";

  let walletModalOpen = $state(false);

  let selectedAddress: Address | null = $state(null);
  let ensName: string | null = $state(null);
  let sendAmount: string | null = $state(null);
  let transactionHash: string | null = $state(null);
  let transactionError: string | null = $state(null);
  let currentStep = $state<"search" | "amount" | "confirm" | "success">("search");

  function handleBack() {
    router.navigate("home");
  }

  function handleWalletSelect(
    address: Address,
    name: string,
    _hasKey: boolean,
  ) {
    selectedAddress = address;
    ensName = name;
    currentStep = "amount";
  }

  function handleAmountSubmit(amount: string) {
    sendAmount = amount;
    currentStep = "confirm";
  }

  function handleBack2Steps() {
    currentStep = "search";
    selectedAddress = null;
    sendAmount = null;
  }

  function handleBackFromAmount() {
    currentStep = "search";
    selectedAddress = null;
  }

  function handleTransactionSuccess(hash: string) {
    transactionHash = hash;
    transactionError = null;
    currentStep = "success";
  }

  function handleTransactionError(error: string) {
    transactionError = error;
  }

  function resetFlow() {
    currentStep = "search";
    selectedAddress = null;
    ensName = null;
    sendAmount = null;
    transactionHash = null;
    transactionError = null;
  }

  function backToHome() {
    router.navigate("home");
  }
</script>

<main class="min-h-screen bg-background p-4">
  <WalletHeader onOpenWalletModal={() => (walletModalOpen = true)} />
  
  <div class="max-w-2xl mx-auto">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <Button
        onclick={handleBack}
        variant="outline"
        size="icon"
        class="rounded-full"
      >
        <ArrowLeft size={18} />
      </Button>
      <div>
        <h1 class="text-3xl font-bold">Send Crypto</h1>
        <p class="text-muted-foreground text-sm">
          Step {currentStep === "search"
            ? "1"
            : currentStep === "amount"
              ? "2"
              : "3"} of 3
        </p>
      </div>
    </div>

    <!-- Progress indicator -->
     <div class="flex gap-2 mb-8">
       <div
         class={`h-1 flex-1 rounded-full transition-colors ${currentStep === "search" ? "bg-primary" : "bg-muted"}`}
       ></div>
       <div
         class={`h-1 flex-1 rounded-full transition-colors ${["amount", "confirm"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}
       ></div>
       <div
         class={`h-1 flex-1 rounded-full transition-colors ${["confirm", "success"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}
       ></div>
     </div>

    <!-- Content -->
    <Card>
       <CardHeader>
         {#if currentStep === "search"}
           <CardTitle>Find Recipient</CardTitle>
           <CardDescription>
             Enter a wallet address or ENS name. We'll verify they have a
             MetaKey.
           </CardDescription>
         {:else if currentStep === "amount"}
           <CardTitle>Send Amount</CardTitle>
           <CardDescription>
             Enter the amount you want to send to this recipient.
           </CardDescription>
         {:else if currentStep === "confirm"}
           <CardTitle>Confirm Transaction</CardTitle>
           <CardDescription>
             Review the transaction details before sending.
           </CardDescription>
         {:else}
           <CardTitle>Transaction Complete</CardTitle>
           <CardDescription>
             Your transaction has been submitted to the network.
           </CardDescription>
         {/if}
       </CardHeader>

        <CardContent>
          {#if currentStep === "search"}
            <WalletSearch onSelect={handleWalletSelect} />
          {:else if currentStep === "amount"}
            {#if selectedAddress}
              <SendAmount
                recipientAddress={selectedAddress}
                recipientName={ensName}
                onSubmit={handleAmountSubmit}
                onBack={handleBackFromAmount}
              />
            {/if}
          {:else if currentStep === "confirm"}
            {#if selectedAddress && sendAmount}
              <SendTransaction
                recipientAddress={selectedAddress}
                recipientName={ensName}
                amount={sendAmount}
                onSuccess={handleTransactionSuccess}
                onError={handleTransactionError}
                onBack={handleBack2Steps}
              />
            {/if}
          {:else}
            <!-- Success State -->
            <div class="space-y-4">
              <Alert class="border-green-500/50 bg-green-500/10">
                <CheckCircle2 size={16} class="text-green-600" />
                <AlertTitle class="text-green-600">Transaction Submitted!</AlertTitle>
                <AlertDescription class="text-green-700">
                  Your transaction has been submitted to the network. You can check its status on the block explorer.
                </AlertDescription>
              </Alert>

              <div class="p-4 bg-card border border-border rounded-md">
                <p class="text-xs text-muted-foreground mb-1">Recipient</p>
                <p class="font-mono text-sm break-all">{ensName || selectedAddress}</p>
              </div>

              <div class="p-4 bg-card border border-border rounded-md">
                <p class="text-xs text-muted-foreground mb-1">Amount</p>
                <p class="text-2xl font-bold">{sendAmount} ETH</p>
              </div>

              {#if transactionHash}
                <div class="p-4 bg-card border border-border rounded-md">
                  <p class="text-xs text-muted-foreground mb-1">Transaction Hash</p>
                  <p class="font-mono text-xs break-all">{transactionHash}</p>
                </div>
              {/if}

              <div class="flex gap-2">
                <Button variant="outline" class="flex-1" onclick={resetFlow}>
                  Send Another
                </Button>
                <Button class="flex-1" onclick={backToHome}>
                  Back to Home
                </Button>
              </div>
            </div>
          {/if}
        </CardContent>
    </Card>
  </div>

  <WalletConnectModal
    open={walletModalOpen}
    onOpenChange={(open) => (walletModalOpen = open)}
    onConnect={() => {}}
  />
</main>
