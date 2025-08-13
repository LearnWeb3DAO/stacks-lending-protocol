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

;; -------------------- LENDER LOGIC --------------------
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

(define-read-only (get-pending-yield)
  (let (
      (user-deposit (map-get? deposits { user: tx-sender }))
      (yield-index (default-to u0 (get yield-index user-deposit)))
      (amount-stx (default-to u0 (get amount user-deposit)))
      (delta (- (var-get cumulative-yield-bips) yield-index))
      (pending-yield (/ (* amount-stx delta) u10000))
    )
    (ok pending-yield)
  )
)

;; -------------------- BORROWER LOGIC --------------------
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
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
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
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
      transfer deposited-sbtc (as-contract tx-sender) tx-sender none
    ))
    (ok true)
  )
)

(define-read-only (get-debt (user principal))
  (let (
      (user-borrow (map-get? borrows { user: user }))
      (borrowed-stx (default-to u0 (get amount user-borrow)))
      (last-accrued (default-to u0 (get last-accrued user-borrow)))
      (latest-timestamp (get-latest-timestamp))
      (dt (- latest-timestamp last-accrued))
      (interest-numerator (* borrowed-stx INTEREST_RATE_PERCENTAGE dt))
      (interest-denominator (* ONE_YEAR_IN_SECS u100))
      (interest (/ interest-numerator interest-denominator))
      (accrued-interest (+ borrowed-stx interest))
    )
    (ok accrued-interest)
  )
)

;; -------------------- LIQUIDATION LOGIC --------------------
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
      (sbtc-balance (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        get-balance (as-contract tx-sender)
      )))
      (xyk-tokens {
        a: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token,
        b: 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2,
      })
      (xyk-pools { a: 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1 })
      (quote (try! (contract-call?
        'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3
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

    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
      transfer (+ pool-reward liquidator-bounty) (as-contract tx-sender)
      tx-sender none
    ))

    (let ((received-stx (try! (contract-call?
        'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3
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

;; -------------------- HELPERS LOGIC --------------------
(define-public (get-sbtc-stx-price)
  (contract-call? .mock-oracle get-price)
)

(define-private (get-latest-timestamp)
  (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1)))
)

(define-private (accrue-interest)
  (let (
      (dt (- (get-latest-timestamp) (var-get last-interest-accrual)))
      (interest-numerator (* u10000 (* (* (var-get total-stx-borrows) INTEREST_RATE_PERCENTAGE) dt)))
      (interest-denominator (* ONE_YEAR_IN_SECS u100))
      (interest (/ interest-numerator interest-denominator))
      (new-yield (/ interest (var-get total-stx-deposits)))
    )
    (if (is-eq (var-get total-stx-borrows) u0)
      (ok true)
      (begin
        (var-set last-interest-accrual (get-latest-timestamp))
        (var-set cumulative-yield-bips
          (+ (var-get cumulative-yield-bips) new-yield)
        )
        (ok true)
      )
    )
  )
)
