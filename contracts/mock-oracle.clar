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
