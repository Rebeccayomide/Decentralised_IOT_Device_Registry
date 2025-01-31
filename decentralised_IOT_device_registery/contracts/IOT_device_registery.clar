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


;; Read-Only Functions
(define-read-only (get-device-info (device-id (string-utf8 36)))
    (map-get? Devices { device-id: device-id })
)

(define-read-only (get-stream-info (stream-id (string-utf8 36)))
    (map-get? DataStreams { stream-id: stream-id })
)

(define-read-only (get-access-grant (user principal) (stream-id (string-utf8 36)))
    (map-get? AccessGrants { user: user, stream-id: stream-id })
)

(define-read-only (get-owner-info (owner principal))
    (map-get? DeviceOwners { owner: owner })
)

(define-read-only (calculate-access-fee (price-per-access uint) (duration uint))
    (let
        ((base-fee (* price-per-access (/ duration u144)))
         (platform-fee (/ (* base-fee (var-get platform-fee-rate)) u10000)))
        {
            base-fee: base-fee,
            platform-fee: platform-fee,
            total-fee: (+ base-fee platform-fee)
        }
    )
)


;; Device Registration and Management
(define-public (register-device
    (device-id (string-utf8 36))
    (name (string-utf8 100))
    (device-type (string-utf8 50))
    (manufacturer (string-utf8 100))
    (firmware-version (string-utf8 20))
    (location (optional (string-utf8 100)))
)
    (let
        ((caller tx-sender))
        
        ;; Check for existing device
        (asserts! (is-none (get-device-info device-id)) ERR-ALREADY-REGISTERED)
        
        ;; Create device record
        (map-set Devices
            { device-id: device-id }
            {
                owner: caller,
                name: name,
                device-type: device-type,
                manufacturer: manufacturer,
                firmware-version: firmware-version,
                registration-date: block-height,
                last-active: block-height,
                status: u"active",
                location: location,
                verified: false
            }
        )
        
        ;; Update owner's device list
        (match (get-owner-info caller)
            prev-owner (begin
                (map-set DeviceOwners
                    { owner: caller }
                    (merge prev-owner {
                        devices: (unwrap! (as-max-len? 
                            (append (get devices prev-owner) device-id)
                            u100
                        ) ERR-NOT-AUTHORIZED)
                    })
                )
                (ok true)
            )
            (begin
                (map-set DeviceOwners
                    { owner: caller }
                    {
                        devices: (list device-id),
                        total-streams: u0,
                        reputation-score: u70,
                        registration-date: block-height,
                        verified: false
                    }
                )
                (ok true)
            )
        )
    )
)


(define-public (register-data-stream
   (stream-id (string-utf8 36))
   (device-id (string-utf8 36))
   (stream-type (string-utf8 50))
   (description (string-utf8 200))
   (data-format (string-utf8 50))
   (update-frequency uint)
   (price-per-access uint)
   (requires-verification bool)
)
   (let
       ((caller tx-sender)
        (device (unwrap! (get-device-info device-id) ERR-DEVICE-NOT-FOUND))
        (owner-info (get-owner-info caller)))
       
       ;; Validate ownership and pricing
       (asserts! (is-eq caller (get owner device)) ERR-NOT-AUTHORIZED)
       (asserts! (>= price-per-access (var-get min-access-price)) ERR-INVALID-PRICE)
       (asserts! (is-some owner-info) ERR-NOT-AUTHORIZED)
       
       (let ((prev-owner (unwrap! owner-info ERR-NOT-AUTHORIZED)))
           ;; Create stream record
           (map-set DataStreams
               { stream-id: stream-id }
               {
                   device-id: device-id,
                   stream-type: stream-type,
                   description: description,
                   data-format: data-format,
                   update-frequency: update-frequency,
                   price-per-access: price-per-access,
                   requires-verification: requires-verification,
                   active: true,
                   created-at: block-height,
                   access-count: u0
               }
           )
           
           ;; Update owner's stream count
           (map-set DeviceOwners
               { owner: caller }
               (merge prev-owner {
                   total-streams: (+ (get total-streams prev-owner) u1)
               })
           )
           
           (ok true)
       )
   )
)
