;; Decentralized IoT Device Registry
;; Description: Smart contract for managing IoT device registration, data streams, and access control

;; Constants and Error Codes
(define-constant ERR-NOT-AUTHORIZED (err u1))
(define-constant ERR-ALREADY-REGISTERED (err u2))
(define-constant ERR-DEVICE-NOT-FOUND (err u3))
(define-constant ERR-STREAM-NOT-FOUND (err u4))
(define-constant ERR-ACCESS-DENIED (err u5))
(define-constant ERR-INVALID-STATUS (err u6))
(define-constant ERR-EXPIRED (err u7))
(define-constant ERR-INVALID-SIGNATURE (err u8))
(define-constant ERR-STREAM-EXISTS (err u9))
(define-constant ERR-INVALID-PRICE (err u10))


;; Data Maps
(define-map Devices
    { device-id: (string-utf8 36) }  ;; UUID format
    {
        owner: principal,
        name: (string-utf8 100),
        device-type: (string-utf8 50),
        manufacturer: (string-utf8 100),
        firmware-version: (string-utf8 20),
        registration-date: uint,      ;; block height
        last-active: uint,            ;; block height
        status: (string-utf8 20),     ;; active, inactive, maintenance
        location: (optional (string-utf8 100)),
        verified: bool
    }
)

(define-map DataStreams
    { stream-id: (string-utf8 36) }   ;; UUID format
    {
        device-id: (string-utf8 36),
        stream-type: (string-utf8 50),
        description: (string-utf8 200),
        data-format: (string-utf8 50),
        update-frequency: uint,        ;; in blocks
        price-per-access: uint,        ;; in microSTX
        requires-verification: bool,
        active: bool,
        created-at: uint,              ;; block height
        access-count: uint
    }
)

(define-map AccessGrants
    { user: principal, stream-id: (string-utf8 36) }
    {
        granted-by: principal,
        grant-date: uint,              ;; block height
        expiry-date: uint,             ;; block height
        access-type: (string-utf8 20), ;; read, write, admin
        payment-status: bool,
        last-access: uint              ;; block height
    }
)

(define-map DeviceOwners
    { owner: principal }
    {
        devices: (list 100 (string-utf8 36)),
        total-streams: uint,
        reputation-score: uint,        ;; 0-100
        registration-date: uint,       ;; block height
        verified: bool
    }
)

(define-map StreamSubscriptions
    { subscriber: principal }
    {
        subscribed-streams: (list 100 (string-utf8 36)),
        total-spent: uint,             ;; in microSTX
        last-payment: uint,            ;; block height
        active-subscriptions: uint
    }
)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var platform-fee-rate uint u25)      ;; 0.25%
(define-data-var min-access-price uint u1000)     ;; in microSTX
(define-data-var default-access-duration uint u144);; ~24 hours in blocks
