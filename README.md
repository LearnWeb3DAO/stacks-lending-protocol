# sBTC-STX Lending Pool: A Developer's Guide

This document serves as a comprehensive guide and tutorial for building a decentralized lending pool for sBTC and STX on the Stacks blockchain. We will walk through the entire process, from understanding the high-level concepts to implementing the smart contracts and testing them.

## High-Level Introduction

The sBTC-STX Lending Pool is a decentralized application (dApp) that allows users to lend and borrow assets in a trustless manner. In this specific implementation, users can:

*   **Lend:** Deposit STX into the lending pool and earn interest on their deposits.
*   **Borrow:** Use their sBTC as collateral to borrow STX.

This project demonstrates the core functionalities of a lending protocol, including deposits, withdrawals, borrowing, repayments, and liquidations.

## Actors Involved

There are three main actors in our lending pool ecosystem:

*   **Lender:** A user who deposits STX into the lending pool to earn yield. The yield is generated from the interest paid by borrowers.
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

;; public functions

;; @desc Initializes the oracle by setting the updater address.
;; @desc Can only be called once by the contract owner.
;; @param new-updater: The principal of the price updater.
;; @returns (response bool)
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
;; @desc Can only be called by the designated updater address.
;; @param new-price: The new price of BTC in STX (as a uint).
;; @returns (response bool)
(define-public (update-price (new-price uint))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-eq tx-sender (var-get updater)) ERR_NOT_UPDATER)
    (var-set btc-stx-price new-price)

    (ok true)
  )
)

;; read only functions

;; @desc Gets the current BTC/STX price.
;; @returns (response uint)
(define-read-only (get-price)
  (ok (var-get btc-stx-price))
)

;; @desc Gets the updater address.
;; @returns principal
(define-read-only (get-updater)
  (var-get updater)
)

;; @desc Checks if the contract has been initialized.
;; @returns bool
(define-read-only (is-initialized)
  (var-get initialized)
)
```

**Explanation:**

*   **`initialize`:** This function is called once by the contract owner to set the `updater` address. The `updater` is the only one who can then call `update-price`.
*   **`update-price`:** This function is called by the `updater` to set the `btc-stx-price`.
*   **`get-price`:** This is a read-only function that returns the current `btc-stx-price`.
*   **`get-updater`:** This is a read-only function that returns the `updater` address.
*   **`is-initialized`:** This is a read-only function that returns whether the contract has been initialized.

### `lending-pool.clar`

This is the main contract that contains the logic for the lending pool.

#### Constants and Data Storage

```clarity
;; Errors
(define-constant ERR_INVALID_WITHDRAW_AMOUNT (err u100))
(define-constant ERR_EXCEEDED_MAX_BORROW (err u101))
(define-constant ERR_CANNOT_BE_LIQUIDATED (err u102))

;; Constants
(define-constant LTV_PERCENTAGE u70)
(define-constant INTEREST_RATE_PERCENTAGE u10)
(define-constant LIQUIDATION_THRESHOLD_PERCENTAGE u90)
(define-constant ONE_YEAR_IN_SECS u31556952)

;; Storage
(define-data-var total-sbtc-collateral uint u0)
(define-data-var total-stx-deposits uint u1)
(define-data-var total-stx-borrows uint u0)

(define-data-var last-interest-accrual uint (get-latest-timestamp))
(define-data-var cumulative-yield-bips uint u0)

(define-map collateral
  { user: principal }
  { amount: uint }
)
(define-map deposits
  { user: principal }
  {
    amount: uint,
    yield-index: uint,
  }
)
(define-map borrows
  { user: principal }
  {
    amount: uint,
    last-accrued: uint,
  }
)
```

**Explanation:**

*   **`LTV_PERCENTAGE`:** Loan-to-Value percentage. This determines the maximum amount a user can borrow against their collateral (70% in this case).
*   **`INTEREST_RATE_PERCENTAGE`:** The annual interest rate for borrowers (10%).
*   **`LIQUIDATION_THRESHOLD_PERCENTAGE`:** If the value of a user's debt exceeds this percentage of their collateral value (90%), they can be liquidated.
*   **`total-sbtc-collateral`:** This variable tracks the total amount of sBTC deposited as collateral.
*   **`total-stx-deposits` and `total-stx-borrows`:** These variables track the total amount of STX deposited and borrowed in the pool.
*   **`collateral`:** This map stores information about each user's sBTC collateral.
*   **`deposits` and `borrows`:** These maps store information about each user's STX deposits and borrows.

#### Lender Logic

```clarity
(define-public (deposit-stx (amount uint))
  (let (
      (user-deposit (map-get? deposits { user: tx-sender }))
      (deposited-stx (default-to u0 (get amount user-deposit)))
    )
    (unwrap-panic (accrue-interest))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set deposits { user: tx-sender } {
      amount: (+ deposited-stx amount),
      yield-index: (var-get cumulative-yield-bips),
    })
    (var-set total-stx-deposits (+ (var-get total-stx-deposits) amount))
    (ok true)
  )
)

(define-public (withdraw-stx (amount uint))
  (let (
      (user tx-sender)
      (user-deposit (map-get? deposits { user: user }))
      (deposited-stx (default-to u0 (get amount user-deposit)))
      (yield-index (default-to u0 (get yield-index user-deposit)))
      (pending-yield (unwrap-panic (get-pending-yield)))
    )
    (asserts! (>= deposited-stx amount) ERR_INVALID_WITHDRAW_AMOUNT)
    (unwrap-panic (accrue-interest))

    (map-set deposits { user: user } {
      amount: (- deposited-stx amount),
      yield-index: (var-get cumulative-yield-bips),
    })
    (var-set total-stx-deposits (- (var-get total-stx-deposits) amount))
    (try! (as-contract (stx-transfer? (+ amount pending-yield) tx-sender user)))
    (ok true)
  )
)
```

**Explanation:**

*   **`deposit-stx`:** A user calls this function to deposit STX into the pool. The function transfers the STX from the user to the contract and updates the user's deposit information.
*   **`withdraw-stx`:** A user calls this function to withdraw their deposited STX. The function checks if the user has enough STX and transfers any pending yield to the user.

#### Borrower Logic

```clarity
(define-public (borrow-stx
    (collateral-amount uint)
    (amount-stx uint)
  )
  (let (
      (user tx-sender)
      (user-collateral (map-get? collateral { user: user }))
      (deposited-sbtc (default-to u0 (get amount user-collateral)))
      (new-collateral (+ deposited-sbtc collateral-amount))
      (price (unwrap-panic (get-sbtc-stx-price)))
      (max-borrow (/ (* (* new-collateral price) LTV_PERCENTAGE) u100))
      (user-borrow (map-get? borrows { user: user }))
      (borrowed-stx (default-to u0 (get amount user-borrow)))
      (user-debt (unwrap-panic (get-debt user)))
      (new-debt (+ user-debt amount-stx))
    )
    (asserts! (<= new-debt max-borrow) ERR_EXCEEDED_MAX_BORROW)

    (unwrap-panic (accrue-interest))
    (map-set borrows { user: user } {
      amount: new-debt,
      last-accrued: (get-latest-timestamp),
    })
    (var-set total-stx-borrows (+ (var-get total-stx-borrows) amount-stx))
    (map-set collateral { user: user } { amount: new-collateral })
    (var-set total-sbtc-collateral
      (+ (var-get total-sbtc-collateral) collateral-amount)
    )
    (try! (contract-call? .sbtc-token
      transfer collateral-amount tx-sender (as-contract tx-sender) none
    ))
    (try! (as-contract (stx-transfer? amount-stx tx-sender user)))
    (ok true)
  )
)

(define-public (repay)
  (let (
      (user-borrow (map-get? borrows { user: tx-sender }))
      (borrowed-stx (default-to u0 (get amount user-borrow)))
      (total-debt (+ u1 (unwrap-panic (get-debt tx-sender))))
      (user-collateral (map-get? collateral { user: tx-sender }))
      (deposited-sbtc (default-to u0 (get amount user-collateral)))
    )
    (unwrap-panic (accrue-interest))

    (map-delete collateral { user: tx-sender })
    (var-set total-sbtc-collateral
      (- (var-get total-sbtc-collateral) deposited-sbtc)
    )
    (map-delete borrows { user: tx-sender })
    (var-set total-stx-borrows (- (var-get total-stx-borrows) borrowed-stx))

    (try! (stx-transfer? total-debt tx-sender (as-contract tx-sender)))
    (try! (contract-call? .sbtc-token
      transfer deposited-sbtc (as-contract tx-sender) tx-sender none
    ))
    (ok true)
  )
)
```

**Explanation:**

*   **`borrow-stx`:** A user calls this function to deposit sBTC as collateral and borrow STX. The function checks if the requested borrow amount is within the allowed LTV.
*   **`repay`:** A user calls this function to repay their STX debt. The function calculates the total debt (including interest), transfers the STX from the user to the contract, and returns the sBTC collateral to the user.

#### Liquidation Logic

```clarity
(define-public (liquidate (user principal))
  (let (
      (user-debt (unwrap-panic (get-debt user)))
      (forfeited-borrows (if (> user-debt (var-get total-stx-borrows))
        (var-get total-stx-borrows)
        user-debt
      ))
      (user-collateral (map-get? collateral { user: user }))
      (deposited-sbtc (default-to u0 (get amount user-collateral)))
      (price (unwrap-panic (get-sbtc-stx-price)))
      (collateral-value-in-stx (* deposited-sbtc price))
      (liquidator-bounty (/ (* deposited-sbtc u10) u100))
      (pool-reward (- deposited-sbtc liquidator-bounty))
      (sbtc-balance (unwrap-panic (contract-call? .sbtc-token
        get-balance (as-contract tx-sender)
      )))
      (xyk-tokens {
        a: .sbtc-token,
        b: .token-stx-v-1-2,
      })
      (xyk-pools { a: .xyk-pool-sbtc-stx-v-1-1 })
      (quote (try! (contract-call?
        .xyk-swap-helper-v-1-3
        get-quote-a pool-reward none xyk-tokens xyk-pools
      )))
    )
    (unwrap-panic (accrue-interest))
    (asserts! (> user-debt u0) ERR_CANNOT_BE_LIQUIDATED)
    (asserts!
      (< (* collateral-value-in-stx u100)
        (* user-debt LIQUIDATION_THRESHOLD_PERCENTAGE)
      )
      ERR_CANNOT_BE_LIQUIDATED
    )

    (var-set total-sbtc-collateral
      (- (var-get total-sbtc-collateral) deposited-sbtc)
    )
    (var-set total-stx-borrows (- (var-get total-stx-borrows) forfeited-borrows))
    (map-delete borrows { user: user })
    (map-delete collateral { user: user })

    (try! (contract-call? .sbtc-token
      transfer (+ pool-reward liquidator-bounty) (as-contract tx-sender)
      tx-sender none
    ))

    (let ((received-stx (try! (contract-call?
        .xyk-swap-helper-v-1-3
        swap-helper-a pool-reward u0 none xyk-tokens xyk-pools
      ))))
      (try! (stx-transfer? received-stx tx-sender (as-contract tx-sender)))

      (var-set cumulative-yield-bips
        (+ (var-get cumulative-yield-bips)
          (/ (* (- received-stx forfeited-borrows) u10000)
            (var-get total-stx-deposits)
          ))
      )
    )

    (ok true)
  )
)
```

**Explanation:**

*   **`liquidate`:** Anyone can call this function to liquidate a user whose loan is underwater. The function checks if the user is eligible for liquidation. If so, it repays the user's debt, gives a portion of the collateral to the liquidator as a bounty, and swaps the rest of the sBTC collateral for STX on a decentralized exchange to replenish the lending pool.

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

*   **Deposit, Borrow, Repay, Withdraw:** This test simulates a user depositing STX, borrowing STX against sBTC collateral, repaying the loan, and then withdrawing their STX. It checks that all the balances and states are updated correctly.
*   **Deposit, Borrow, Liquidate:** This test simulates a user depositing STX, borrowing STX against sBTC collateral, and then having their position liquidated when the sBTC price drops. It checks that the liquidator receives the bounty and the user's debt is cleared.

These tests use the `simnet` object provided by `@stacks/clarity-native-bin` to simulate the Stacks blockchain environment and interact with the smart contracts.

## Conclusion

This document has provided a comprehensive overview of the sBTC-STX Lending Pool project. By following this guide, you should have a solid understanding of how to build a decentralized lending application on the Stacks blockchain. You can use this project as a foundation to build more complex and feature-rich DeFi applications.