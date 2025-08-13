# sBTC-STX Lending Pool: A Developer's Guide

This document serves as a comprehensive guide and tutorial for building a decentralized lending pool for sBTC and STX on the Stacks blockchain. We will walk through the entire process, from understanding the high-level concepts to implementing the smart contracts and testing them.

## High-Level Introduction

The sBTC-STX Lending Pool is a decentralized application (dApp) that allows users to lend and borrow assets in a trustless manner. In this specific implementation, users can:

*   **Lend:** Deposit sBTC (a wrapped version of Bitcoin on Stacks) into the lending pool and earn interest on their deposits.
*   **Borrow:** Use their deposited sBTC as collateral to borrow STX (the native token of the Stacks blockchain).

This project demonstrates the core functionalities of a lending protocol, including deposits, withdrawals, borrowing, repayments, and liquidations.

## Actors Involved

There are three main actors in our lending pool ecosystem:

*   **Lender:** A user who deposits sBTC into the lending pool to earn yield. The yield is generated from the interest paid by borrowers.
*   **Borrower:** A user who deposits sBTC as collateral to borrow STX. They pay interest on their borrowed STX, which is then distributed to the lenders.
*   **Liquidator:** A user who monitors the health of loans and repays the debt of borrowers whose collateral value has fallen below a certain threshold. In return for repaying the debt, the liquidator receives a portion of the borrower's collateral as a reward.

## The Role of the Oracle

To determine how much STX a user can borrow against their sBTC collateral, we need to know the price of sBTC in STX. This is where an oracle comes in. An oracle is a service that provides external data (in this case, the sBTC/STX price) to a smart contract.

Since blockchain environments are deterministic, they cannot directly access off-chain data. Oracles bridge this gap by fetching data from the outside world and making it available on-chain.

## Why a Mock Oracle?

For development and testing purposes, relying on a real-world oracle can be slow, expensive, and sometimes unreliable. A mock oracle is a smart contract that simulates the behavior of a real oracle, allowing us to control the price data for testing different scenarios.

In our project, we use a mock oracle that allows a designated "updater" to set the sBTC/STX price. This gives us the flexibility to test various conditions, such as price fluctuations that could lead to liquidations.

## Smart Contract Implementation

Now, let's dive into the implementation of our smart contracts. We have two main contracts: `lending-pool.clar` and `mock-oracle.clar`.

### `mock-oracle.clar`

This contract is responsible for storing and updating the sBTC/STX price.

```clarity
;; title: mock-oracle
;; version: 1.0.0
;; summary: A mock oracle for providing BTC/STX price data.
;; description: This contract allows a designated owner to set an updater address, which can then periodically update the BTC price in STX.

;; constants
(define-constant ERR_NOT_OWNER (err u100))
(define-constant ERR_ALREADY_INITIALIZED (err u101))
(define-constant ERR_NOT_UPDATER (err u102))
(define-constant ERR_NOT_INITIALIZED (err u103))

;; data vars
(define-data-var owner principal tx-sender)
(define-data-var updater principal tx-sender)
(define-data-var initialized bool false)
(define-data-var btc-stx-price uint u0)

;; @desc Initializes the oracle by setting the updater address.
(define-public (initialize (new-updater principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR_NOT_OWNER)
    (asserts! (not (var-get initialized)) ERR_ALREADY_INITIALIZED)
    (var-set updater new-updater)
    (var-set initialized true)
    (ok true)
  )
)

;; @desc Updates the BTC/STX price.
(define-public (update-price (new-price uint))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-eq tx-sender (var-get updater)) ERR_NOT_UPDATER)
    (var-set btc-stx-price new-price)
    (ok true)
  )
)

;; @desc Gets the current BTC/STX price.
(define-read-only (get-price)
  (ok (var-get btc-stx-price))
)
```

**Explanation:**

*   **`initialize`:** This function is called once by the contract owner to set the `updater` address. The `updater` is the only one who can then call `update-price`.
*   **`update-price`:** This function is called by the `updater` to set the `btc-stx-price`.
*   **`get-price`:** This is a read-only function that returns the current `btc-stx-price`.

### `lending-pool.clar`

This is the main contract that contains the logic for the lending pool.

#### Constants and Data Storage

```clarity
;; Constants
(define-constant LTV_PERCENTAGE u70)
(define-constant INTEREST_RATE_PERCENTAGE u10)
(define-constant LIQUIDATION_THRESHOLD_PERCENTAGE u75)
(define-constant ONE_YEAR_IN_SECS u86400)

;; Storage
(define-data-var total-deposits uint u1)
(define-data-var total-borrows uint u0)
(define-data-var last-interest-accrual uint (get-latest-timestamp))
(define-data-var cumulative-yield-per-sbtc uint u0)
(define-map deposits
  { user: principal }
  {
    amount-sbtc: uint,
    yield-index: uint,
  }
)
(define-map borrows
  { user: principal }
  {
    amount-stx: uint,
    last-accrued: uint,
  }
)
```

**Explanation:**

*   **`LTV_PERCENTAGE`:** Loan-to-Value percentage. This determines the maximum amount a user can borrow against their collateral (70% in this case).
*   **`INTEREST_RATE_PERCENTAGE`:** The annual interest rate for borrowers (10%).
*   **`LIQUIDATION_THRESHOLD_PERCENTAGE`:** If the value of a user's debt exceeds this percentage of their collateral value (75%), they can be liquidated.
*   **`total-deposits` and `total-borrows`:** These variables track the total amount of sBTC deposited and STX borrowed in the pool.
*   **`deposits` and `borrows`:** These maps store information about each user's deposits and borrows.

#### Lender Logic

```clarity
(define-public (deposit (amount uint))
  (let (
      (user-deposit (map-get? deposits { user: tx-sender }))
      (deposited-sbtc (default-to u0 (get amount-sbtc user-deposit)))
    )
    (unwrap-panic (accrue-interest))
    (try! (contract-call? .sbtc-token transfer amount tx-sender (as-contract tx-sender) none))
    (map-set deposits { user: tx-sender } {
      amount-sbtc: (+ deposited-sbtc amount),
      yield-index: (var-get cumulative-yield-per-sbtc),
    })
    (var-set total-deposits (+ (var-get total-deposits) amount))
    (ok true)
  )
)

(define-public (withdraw (amount uint))
  (let (
      (user-deposit (map-get? deposits { user: tx-sender }))
      (deposited-sbtc (default-to u0 (get amount-sbtc user-deposit)))
      (pending-yield (unwrap-panic (get-pending-yield)))
      (user-borrow (map-get? borrows { user: tx-sender }))
      (user-borrowed-stx (default-to u0 (get amount-stx user-borrow)))
      (price (unwrap-panic (get-sbtc-stx-price)))
      (remaining-sbtc (- deposited-sbtc amount))
      (max-borrow (/ (* (* remaining-sbtc price) LTV_PERCENTAGE) u100))
    )
    (asserts! (>= deposited-sbtc amount) (err u100))
    (asserts! (<= user-borrowed-stx max-borrow) (err u101))
    (unwrap-panic (accrue-interest))
    (map-set deposits { user: tx-sender } {
      amount-sbtc: remaining-sbtc,
      yield-index: (var-get cumulative-yield-per-sbtc),
    })
    (var-set total-deposits (- (var-get total-deposits) amount))
    (try! (contract-call? .sbtc-token transfer amount (as-contract tx-sender) tx-sender none))
    (try! (as-contract (stx-transfer? pending-yield tx-sender tx-sender)))
    (ok true)
  )
)
```

**Explanation:**

*   **`deposit`:** A user calls this function to deposit sBTC into the pool. The function transfers the sBTC from the user to the contract and updates the user's deposit information.
*   **`withdraw`:** A user calls this function to withdraw their deposited sBTC. The function checks if the user has enough sBTC and if the withdrawal would not put their loan in an unhealthy state. It also transfers any pending yield to the user.

#### Borrower Logic

```clarity
(define-public (borrow (amount-stx uint))
  (let (
      (user-deposit (map-get? deposits { user: tx-sender }))
      (deposited-sbtc (default-to u0 (get amount-sbtc user-deposit)))
      (price (unwrap-panic (get-sbtc-stx-price)))
      (max-borrow (/ (* (* deposited-sbtc price) LTV_PERCENTAGE) u100))
      (user-borrow (map-get? borrows { user: tx-sender }))
      (borrowed-stx (default-to u0 (get amount-stx user-borrow)))
      (new-debt (+ borrowed-stx amount-stx))
    )
    (asserts! (<= new-debt max-borrow) (err u102))
    (map-set borrows { user: tx-sender } {
      amount-stx: new-debt,
      last-accrued: (get-latest-timestamp),
    })
    (var-set total-borrows (+ (var-get total-borrows) amount-stx))
    (try! (as-contract (stx-transfer? amount-stx tx-sender tx-sender)))
    (ok true)
  )
)

(define-public (repay)
  (let (
      (user-borrow (map-get? borrows { user: tx-sender }))
      (total-debt (unwrap-panic (get-debt tx-sender)))
      (borrowed-stx (default-to u0 (get amount-stx user-borrow)))
    )
    (try! (stx-transfer? total-debt tx-sender (as-contract tx-sender)))
    (var-set total-borrows (- (var-get total-borrows) borrowed-stx))
    (map-delete borrows { user: tx-sender })
    (ok true)
  )
)
```

**Explanation:**

*   **`borrow`:** A user calls this function to borrow STX against their deposited sBTC. The function checks if the requested borrow amount is within the allowed LTV.
*   **`repay`:** A user calls this function to repay their STX debt. The function calculates the total debt (including interest) and transfers the STX from the user to the contract.

#### Liquidation Logic

```clarity
(define-public (liquidate (user principal))
  (let (
      (user-debt (unwrap-panic (get-debt user)))
      (user-deposit (map-get? deposits { user: user }))
      (deposited-sbtc (default-to u0 (get amount-sbtc user-deposit)))
      (price (unwrap-panic (get-sbtc-stx-price)))
      (collateral-value-in-stx (* deposited-sbtc price))
      (liquidator-bounty (/ (* deposited-sbtc u10) u100))
      (pool-reward (- deposited-sbtc liquidator-bounty))
    )
    (asserts! (> user-debt u0) (err u103))
    (asserts!
      (< (* collateral-value-in-stx u100)
        (* user-debt LIQUIDATION_THRESHOLD_PERCENTAGE)
      )
      (err u104)
    )
    (var-set total-deposits (- (var-get total-deposits) deposited-sbtc))
    (var-set total-borrows (- (var-get total-borrows) user-debt))
    (map-delete deposits { user: user })
    (map-delete borrows { user: user })
    (try! (contract-call? .sbtc-token transfer liquidator-bounty (as-contract tx-sender) tx-sender none))
    (try! (as-contract (stx-transfer? pool-reward tx-sender (as-contract tx-sender))))
    (ok true)
  )
)
```

**Explanation:**

*   **`liquidate`:** Anyone can call this function to liquidate a user whose loan is underwater. The function checks if the user is eligible for liquidation. If so, it repays the user's debt, gives a portion of the collateral to the liquidator as a bounty, and keeps the rest for the pool.

## Testing

Testing is a crucial part of smart contract development. We have two test files: `mock-oracle.test.ts` and `lending-pool.test.ts`.

### `mock-oracle.test.ts`

This file contains tests for the `mock-oracle.clar` contract. It tests the following scenarios:

*   The owner can initialize the oracle.
*   Non-owners cannot initialize the oracle.
*   The oracle cannot be re-initialized.
*   The updater can update the price.
*   Non-updaters cannot update the price.
*   The price cannot be updated if the oracle is not initialized.

### `lending-pool.test.ts`

This file contains tests for the `lending-pool.clar` contract. It tests the end-to-end user flows:

*   **Deposit, Borrow, Repay, Withdraw:** This test simulates a user depositing sBTC, borrowing STX, repaying the loan, and then withdrawing their sBTC. It checks that all the balances and states are updated correctly.
*   **Deposit, Borrow, Liquidate:** This test simulates a user depositing sBTC, borrowing STX, and then having their position liquidated when the sBTC price drops. It checks that the liquidator receives the bounty and the user's debt is cleared.

These tests use the `simnet` object provided by `@stacks/clarity-native-bin` to simulate the Stacks blockchain environment and interact with the smart contracts.

## Conclusion

This document has provided a comprehensive overview of the sBTC-STX Lending Pool project. By following this guide, you should have a solid understanding of how to build a decentralized lending application on the Stacks blockchain. You can use this project as a foundation to build more complex and feature-rich DeFi applications.
