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
