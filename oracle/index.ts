import { STACKS_TESTNET } from "@stacks/network";
import {
  cvToValue,
  fetchCallReadOnlyFunction,
  makeContractCall,
  privateKeyToAddress,
  uintCV,
  type SignedContractCallOptions,
} from "@stacks/transactions";

const STACKS_PRIVATE_KEY = process.env.STACKS_PRIVATE_KEY;
const ORACLE_PRINCIPAL = process.env.ORACLE_PRINCIPAL;

if (!STACKS_PRIVATE_KEY) {
  throw new Error("STACKS_PRIVATE_KEY environment variable is not set");
}

if (!ORACLE_PRINCIPAL) {
  throw new Error("ORACLE_PRINCIPAL environment variable is not set");
}

const stxAddress = privateKeyToAddress(STACKS_PRIVATE_KEY!, STACKS_TESTNET);
const [oracleAddress, oracleName] = ORACLE_PRINCIPAL.split(".");
if (!oracleAddress || !oracleName) {
  throw new Error("Invalid oracle principal");
}

async function main() {
  await ensureInitialized();
  await ensureUpdaterAddressMatches();

  while (true) {
    await updateBtcStxPrice();
    await sleep(5 * 60 * 1000);
  }
}

async function updateBtcStxPrice() {
  try {
    const priceData = await fetchCurrencyPriceVsUSD();
    if (!priceData) throw new Error("Failed to fetch price data");

    const btcPriceInStx = Math.floor(
      priceData.bitcoin.usd / priceData.blockstack.usd
    );
    console.log(`1 BTC = ${btcPriceInStx} STX`);

    const txOptions: SignedContractCallOptions = {
      contractAddress: oracleAddress!,
      contractName: oracleName!,
      functionName: "update-price",
      functionArgs: [uintCV(btcPriceInStx)],
      senderKey: STACKS_PRIVATE_KEY!,
      network: STACKS_TESTNET,
    };

    const transaction = await makeContractCall(txOptions);
    console.log("Transaction broadcasted:", transaction);
  } catch (error) {
    console.error("Error fetching or updating price:", error);
  }
}

async function ensureUpdaterAddressMatches() {
  const response = await fetchCallReadOnlyFunction({
    contractName: oracleName!,
    contractAddress: oracleAddress!,
    functionName: "get-updater",
    functionArgs: [],
    senderAddress: stxAddress,
    network: STACKS_TESTNET,
  });
  const updaterAddress = cvToValue(response) as string;
  if (updaterAddress !== stxAddress) {
    throw new Error("Updater address does not match");
  }
}

async function ensureInitialized() {
  const response = await fetchCallReadOnlyFunction({
    contractName: oracleName!,
    contractAddress: oracleAddress!,
    functionName: "is-initialized",
    functionArgs: [],
    senderAddress: stxAddress,
    network: STACKS_TESTNET,
  });

  const initialized = cvToValue(response) as boolean;
  if (!initialized) {
    throw new Error("Oracle is not initialized");
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PriceResponse = {
  bitcoin: {
    usd: number;
  };
  blockstack: {
    usd: number;
  };
};

async function fetchCurrencyPriceVsUSD() {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd`
    );
    const data = (await response.json()) as PriceResponse;
    return data;
  } catch (error) {
    console.error("Error fetching currency price:", error);
    return null;
  }
}

main();
