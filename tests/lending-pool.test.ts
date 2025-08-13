import { Cl, ClarityType, cvToValue } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;

const faucet = accounts.get("faucet")!;

const updater = accounts.get("wallet_1")!;
const lender = accounts.get("wallet_2")!;
const borrower = accounts.get("wallet_3")!;
const liquidator = accounts.get("wallet_4")!;

describe("Lending Pool Tests", () => {
  beforeEach(() => {
    initializeOracle();
    const oneBTC = 100_000_000;
    mintSBTC(oneBTC, deployer);
    mintSBTC(oneBTC, borrower);

    mintSTX(100_000_000, deployer);
    mintSTX(100_000_000, lender);
    mintSTX(100_000_000, liquidator);
  });

  it("Can let lenders deposit STX", () => {
    const { result: depositResult } = simnet.callPublicFn(
      "lending-pool",
      "deposit-stx",
      [Cl.uint(100_000_000)],
      lender
    );
    expect(depositResult).toBeOk(Cl.bool(true));
    expect(getTotalDeposits()).toBe(100_000_000 + 1);
  });

  it("Can borrow STX against sBTC collateral within LTV Ratio", () => {
    const { result: depositResult } = simnet.callPublicFn(
      "lending-pool",
      "deposit-stx",
      [Cl.uint(100_000_000)],
      lender
    );
    expect(depositResult).toBeOk(Cl.bool(true));
    expect(getTotalDeposits()).toBe(100_000_000 + 1);

    // Set 1 BTC = 10 STX
    updateOracle(10);
    const { result: borrowResult } = simnet.callPublicFn(
      "lending-pool",
      "borrow-stx",
      [Cl.uint(1), Cl.uint(7)],
      borrower
    );
    expect(borrowResult).toBeOk(Cl.bool(true));
  });

  it("Can't borrow STX against sBTC collateral outside LTV Ratio", () => {
    const { result: depositResult } = simnet.callPublicFn(
      "lending-pool",
      "deposit-stx",
      [Cl.uint(100_000_000)],
      lender
    );
    expect(depositResult).toBeOk(Cl.bool(true));
    expect(getTotalDeposits()).toBe(100_000_000 + 1);

    // Set 1 BTC = 10 STX
    updateOracle(10);
    const { result: borrowResult } = simnet.callPublicFn(
      "lending-pool",
      "borrow-stx",
      [Cl.uint(1), Cl.uint(10)],
      borrower
    );
    expect(borrowResult).toBeErr(Cl.uint(101));
  });

  it("Borrower can borrow and repay STX, lender earns yield", () => {
    const { result: depositResult } = simnet.callPublicFn(
      "lending-pool",
      "deposit-stx",
      [Cl.uint(1_000_000)],
      lender
    );
    expect(depositResult).toBeOk(Cl.bool(true));
    expect(getTotalDeposits()).toBe(1_000_000 + 1);

    updateOracle(10);

    const { result: borrowResult } = simnet.callPublicFn(
      "lending-pool",
      "borrow-stx",
      [Cl.uint(100_000), Cl.uint(700_000)],
      borrower
    );
    expect(borrowResult).toBeOk(Cl.bool(true));

    // slightly more than 1 day
    simnet.mineEmptyBlocks(150);

    const debt = getUserDebt(borrower);
    expect(debt).toBeGreaterThan(700_190);
    expect(debt).toBeLessThan(700_200);

    const { result: repayResult } = simnet.callPublicFn(
      "lending-pool",
      "repay",
      [],
      borrower
    );
    expect(repayResult).toBeOk(Cl.bool(true));

    const lenderPendingYield = getPendingYield(lender);
    expect(lenderPendingYield).toBe(100);
    const { result: withdrawResult } = simnet.callPublicFn(
      "lending-pool",
      "withdraw-stx",
      [Cl.uint(1_000_000)],
      lender
    );
    expect(withdrawResult).toBeOk(Cl.bool(true));
  });

  it("Borrower can borrow, gets liquidated if price drops below liquidation threshold", () => {
    const { result: depositResult } = simnet.callPublicFn(
      "lending-pool",
      "deposit-stx",
      [Cl.uint(10_000)],
      lender
    );
    expect(depositResult).toBeOk(Cl.bool(true));
    expect(getTotalDeposits()).toBe(10_000 + 1);

    updateOracle(10);

    const { result: borrowResult } = simnet.callPublicFn(
      "lending-pool",
      "borrow-stx",
      [Cl.uint(1000), Cl.uint(7000)],
      borrower
    );
    expect(borrowResult).toBeOk(Cl.bool(true));

    const debt = getUserDebt(borrower);
    expect(debt).toBe(7000);
    expect(getTotalBorrows()).toBe(7000);

    updateOracle(5);

    expect(getSBTCBalance(liquidator)).toBe(0);

    const { result: liquidateResult } = simnet.callPublicFn(
      "lending-pool",
      "liquidate",
      [Cl.principal(borrower)],
      liquidator
    );
    expect(liquidateResult).toBeOk(Cl.bool(true));

    expect(getUserDebt(borrower)).toBe(0);
    expect(getTotalCollateral()).toBe(0);
    expect(getTotalBorrows()).toBe(0);
    expect(getSBTCBalance(liquidator)).toBe(100);

    const { result: withdrawResult } = simnet.callPublicFn(
      "lending-pool",
      "withdraw-stx",
      [Cl.uint(10_000)],
      lender
    );
    expect(withdrawResult).toBeOk(Cl.bool(true));
  });
});

function getTotalDeposits() {
  const totalDeposits = simnet.getDataVar("lending-pool", "total-stx-deposits");
  return Number(cvToValue(totalDeposits));
}

function getTotalBorrows() {
  const totalBorrows = simnet.getDataVar("lending-pool", "total-stx-borrows");
  return Number(cvToValue(totalBorrows));
}

function getTotalCollateral() {
  const totalCollateral = simnet.getDataVar(
    "lending-pool",
    "total-sbtc-collateral"
  );
  return Number(cvToValue(totalCollateral));
}

function getUserDebt(user: string) {
  const { result } = simnet.callReadOnlyFn(
    "lending-pool",
    "get-debt",
    [Cl.principal(user)],
    user
  );
  if (result.type === ClarityType.ResponseOk) {
    return Number(cvToValue(result.value));
  }

  throw new Error("Could not load user debt");
}

function getPendingYield(user: string) {
  const { result } = simnet.callReadOnlyFn(
    "lending-pool",
    "get-pending-yield",
    [],
    user
  );

  if (result.type === ClarityType.ResponseOk) {
    return Number(cvToValue(result.value));
  }

  throw new Error("Could not load pending yield");
}

function mintSBTC(amount: number, recipient: string) {
  const { result } = simnet.callPrivateFn(
    "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    "protocol-mint-many-iter",
    [
      Cl.tuple({
        amount: Cl.uint(amount),
        recipient: Cl.principal(recipient),
      }),
    ],
    deployer
  );
  expect(result).toBeOk(Cl.bool(true));
}

function getSBTCBalance(user: string) {
  const { result } = simnet.callReadOnlyFn(
    "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    "get-balance",
    [Cl.principal(user)],
    user
  );

  if (result.type === ClarityType.ResponseOk) {
    return Number(cvToValue(result.value));
  }

  throw new Error("Could not load sbtc balance");
}

function mintSTX(amount: number, recipient: string) {
  const { result } = simnet.transferSTX(amount, recipient, faucet);
  expect(result).toBeOk(Cl.bool(true));
}

function initializeOracle() {
  const { result } = simnet.callPublicFn(
    "mock-oracle",
    "initialize",
    [Cl.principal(updater)],
    deployer
  );
  expect(result).toBeOk(Cl.bool(true));
}

function updateOracle(price: number) {
  const { result } = simnet.callPublicFn(
    "mock-oracle",
    "update-price",
    [Cl.uint(price)],
    updater
  );
  expect(result).toBeOk(Cl.bool(true));
}
