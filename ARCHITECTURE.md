# 1Driver Main API

Ride-hailing backend API'si. Mobil uygulamalar bu API'ye bağlanır; kullanıcı verileri ayrı bir **User Service**'te tutulur.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
  - [User Service (1driver-user-api)](#user-service-1driver-user-api)
  - [Müşteri ve Sürücü Oluşturma](#müşteri-ve-sürücü-oluşturma)
  - [Trip Lifecycle + Sürücü Eşleştirme](#trip-lifecycle--sürücü-eşleştirme)
  - [Event Delivery — Bildirim Yönlendirme](#event-delivery--bildirim-yönlendirme)
  - [WebSocket Sistemi](#websocket-sistemi)
  - [Veritabanları](#veritabanları)
- [Dizin Yapısı](#dizin-yapısı)

## Background

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Mobil App   │────▶│  Main API        │────▶│  User Service    │
│  (Customer/  │◀────│                  │◀────│  (1driver-user)  │
│   Driver)    │     │                  │     │  MongoDB         │
└──────┬───────┘     │  MongoDB         │     └──────────────────┘
       │             │  Redis/Valkey    │     ┌──────────────────┐
       │  WebSocket  │  BullMQ Queues   │────▶│  Stripe / S3 /   │
       └────────────▶│                  │◀────│  Google Maps /   │
                     └──────────────────┘     │  SMS / Expo Push │
                                              └──────────────────┘
```

**Stack:** NestJS 11 + Fastify, MongoDB (Mongoose), Redis/Valkey, BullMQ, Socket.IO, Stripe, S3, Sentry

## Install

```bash
npm install
```

## Usage

```bash
npm run start:dev       # Development (hot reload)
npm run build && npm run start:prod  # Production
npm run seed:admin      # İlk super admin oluştur
```

Swagger: `http://localhost:3000/api/docs`

## API

### User Service (1driver-user-api)

Main API'de kullanıcı (customer/driver) verisi **tutulmaz**. User Service, hem müşteri hem sürücü hesaplarının yönetildiği **tek bir API**'dir. `src/clients/` altındaki **3 HTTP istemcisi de aynı API'ye** istek atar:

| İstemci | Config key | Ne yapar |
|---------|-----------|----------|
| `AuthClient` | `auth.url` | Kayıt, giriş, OTP oluşturma/doğrulama |
| `CustomersClient` | `users.url` | Müşteri profil, adres, fotoğraf, Stripe ID, expo token |
| `DriversClient` | `users.url` | Sürücü profil, belge, banka bilgisi, başvuru onay/red |

#### Nerelerde User Service'e gidilir?

- **Auth:** Kayıt, giriş, OTP oluşturma/doğrulama → `AuthClient`
- **Profil okuma/yazma:** `GET /customers/:id`, `PATCH /customers/:id/profile`, fotoğraf, adres → `CustomersClient`
- **Trip sırasında:** Müşteriye aktif trip yazmak (`PUT /customers/:id/active-trip`), sürücü bilgisi çekmek → `CustomersClient` / `DriversClient`
- **Stripe bağlama:** `PATCH /customers/:id/stripe-customer-id` → `CustomersClient`
- **Belge yükleme:** S3'e yüklenir, sonra `POST /drivers/:id/files/notify` ile User Service'e bildirilir → `DriversClient`
- **Admin işlemleri:** Başvuru listele, onayla, reddet (`GET /drivers/applications`, `POST /drivers/:id/approve`) → `DriversClient`

### Müşteri ve Sürücü Oluşturma

#### Müşteri Kayıt

```
Mobil App                    Main API                     User Service
    │                            │                            │
    ├─ POST initiate-signup ────▶│                            │
    │  {phone, name, email}      ├─ POST initiate-signup ───▶│ Kullanıcı oluştur + OTP üret
    │                            │◀─ {customer, otp} ────────┤
    │                            ├─ SMS ile OTP gönder        │
    │                            ├─ Stripe Customer oluştur   │
    │◀─ "OTP gönderildi" ───────┤                            │
    │                            │                            │
    ├─ POST complete-signup ────▶├─ POST complete-signup ───▶│ OTP doğrula
    │◀─ {token, customer} ──────┤◀─ {token, customer} ──────┤
```

#### Sürücü Kayıt

Aynı akış + ek adımlar:

- `complete-signup` sonrası **haftalık kazanç kaydı** başlatılır (`DriverWeeklyEarnings`)
- Sürücü belge yükler → S3 → User Service'e `notifyFileUploaded`
- Admin onaylarsa → `POST /drivers/:id/approve` → User Service sürücüyü aktifleştirir

#### Giriş (OTP Akışı)

1. `initiate-signin` → User Service OTP üretir → Main API SMS gönderir
2. `complete-signin` → User Service OTP doğrular + JWT token döner
3. Main API token + deviceId'yi **Redis session** olarak saklar
4. Her cihazda tek oturum — yeni giriş eskisini kapatır (force logout)

#### Admin

- `POST /api/admin/auth/login` — email + password (bcrypt)
- Admin kullanıcıları Main API'nin **kendi** MongoDB'sinde tutulur
- Roller: `SUPER_ADMIN`, `NORMAL_ADMIN`

### Trip Lifecycle + Sürücü Eşleştirme

#### Status Flow

```
DRAFT ──▶ WAITING_FOR_DRIVER ──▶ APPROVED ──▶ DRIVER_ON_WAY_TO_PICKUP
                 │                                       │
                 ▼                              ARRIVED_AT_PICKUP
          DRIVER_NOT_FOUND                               │
                                                TRIP_IN_PROGRESS
          CANCELLED                                      │
                                                     PAYMENT ──▶ COMPLETED
                                                         │
                                                  PAYMENT_RETRY ──▶ CANCELLED_PAYMENT
```

#### 1. Draft Oluşturma (`POST /api/customer-trips/create-draft`)

- Müşteri rota gönderir (başlangıç + bitiş + duraklar)
- **Google Maps API** ile mesafe ve süre hesaplanır
- Tahmini ücret hesaplanır, MongoDB'ye `DRAFT` olarak kaydedilir

#### 2. Sürücü Talebi + Eşleştirme (`POST /api/customer-trips/request-driver`)

Trip `WAITING_FOR_DRIVER` olur ve eşleştirme başlar:

**a) Yakındaki sürücü arama:**

- Redis **GEOSEARCH** ile müşteri konumu etrafındaki sürücüler bulunur
- Sadece `AVAILABLE` durumundaki sürücüler filtrelenir
- Mesafeye göre sıralanır (en yakın önce)
- `calledDriverIds` listesi trip'e yazılır

**b) Sıralı bildirim (BullMQ):**

Sürücülere **tek tek** bildirim gönderilir, hepsi aynı anda değil:

```
trip-requests kuyruğu
┌─────────────────┐
│ Job: driver=A   │──▶ TripRequestProcessor:
│ Job: driver=B   │    1. Trip hâlâ WAITING_FOR_DRIVER mı?
│ Job: driver=C   │    2. Sürücü hâlâ AVAILABLE mı?
└─────────────────┘    3. Google Maps: sürücü → toplama noktası mesafesi
                       4. Sürücüye trip:requested event'i gönder
```

**c) Zaman aşımı mekanizması:**

Her bildirimde `trip-timeouts` kuyruğuna timeout job eklenir (varsayılan 20sn):

```
Sürücü A'ya bildirim gönderildi
    │
    ├── Kabul etti → Trip APPROVED, diğerlerine trip:already_taken
    │
    └── 20sn geçti → TripTimeoutProcessor:
        ├── A → rejectedDriverIds'e eklenir, trip:already_taken gönderilir
        ├── Sıradaki sürücü B'ye bildirim gönderilir
        └── Hepsi reddettiyse → DRIVER_NOT_FOUND, müşteriye bildirim
```

#### 3. Sürücü Kabul (`POST /api/driver-trips/accept/:tripId`)

- **Distributed lock** alınır (race condition önleme)
- Trip `APPROVED`, sürücü bilgileri trip'e yazılır
- Sürücü → `ON_TRIP` durumu
- Müşteriye `trip:driver_assigned` event'i

#### 4. Yolculuk Adımları (sürücü tetikler)

- `start-en-route` → `DRIVER_ON_WAY_TO_PICKUP` (konum paylaşımı başlar)
- `arrive-at-pickup` → `ARRIVED_AT_PICKUP`
- `start-trip` → `TRIP_IN_PROGRESS`
- Her adımda müşteriye WebSocket event

#### 5. Yolculuk Bitişi ve Ödeme

- Trip → `PAYMENT`, müşteriye `trip:payment_required`
- `POST /api/customer-trips/process-payment` → Stripe Payment Intent
- Başarılı → `COMPLETED`, sürücü kazancı haftalık tabloya eklenir
- Başarısız → `PAYMENT_RETRY`

#### 6. İptal

- Müşteri veya sürücü iptal edebilir
- Geç iptal → `Penalty` kaydı (ceza tipi: DRIVER_LATE_CANCELLATION, CUSTOMER_NO_SHOW, vb.)

### Event Delivery — Bildirim Yönlendirme

Trip event'leri gönderilirken kullanıcının **uygulama durumuna** göre kanal seçilir:

```
Event2Service.sendToUser(userId, eventType, data)
    │
    ├── determineDeliveryMethod(userId):
    │   Redis'ten kullanıcının AppState'ini oku
    │
    ├── AppState === FOREGROUND
    │   └── WebSocket ile gönder (anlık, uygulama açık)
    │
    └── AppState !== FOREGROUND (BACKGROUND veya bağlantı yok)
        └── Expo Push Notification gönder
            ├── User Service'ten expoToken çek
            └── Expo SDK ile push bildirim at
```

#### AppState Nasıl Belirlenir?

- Mobil uygulama `PUT /api/common/app-state` ile durumunu bildirir: `FOREGROUND` veya `BACKGROUND`
- WebSocket bağlantısında otomatik `FOREGROUND` yapılır
- WebSocket kopmasında otomatik `BACKGROUND` yapılır
- Redis'te saklanır: `driver:app-state:{id}` / `customer:app-state:{id}`

#### Toplu Gönderim (sendToUsers)

Birden fazla kullanıcıya event gönderirken `categorizeUsersByStatus` ile kullanıcılar ikiye ayrılır:

- **activeUsers** (FOREGROUND) → WebSocket
- **inactiveUsers** (BACKGROUND/yok) → Push notification (batch)

### WebSocket Sistemi

Transport: **WebSocket only** (polling yok) | Ping: 5sn | Timeout: 2sn

#### Bağlantı Kimlik Doğrulama

```
Client bağlanır
    ├── Token: auth.token → query.token → Authorization header
    ├── DeviceId: x-device-id header → query → auth.deviceId
    ├── JWT doğrula → Redis session kontrol (token + deviceId eşleşmeli)
    │
    ├── Başarılı → Odalara katıl:
    │   ├── user:{userId}     → kişiye özel
    │   ├── type:{DRIVER}     → tüm sürücülere broadcast
    │   └── device:{deviceId} → cihaza özel
    │
    ├── Sürücü → BUSY, bağlı işaretle, AppState=FOREGROUND
    └── Müşteri → aktif işaretle, AppState=FOREGROUND
```

#### Client → Server Mesajları

| Message | Açıklama |
|---------|----------|
| `updateLocation` | Konum güncelle; aktif trip varsa karşı tarafa `driver:location_updated` ilet |
| `updateDriverAvailability` | Müsaitlik: AVAILABLE / BUSY / OFF_DUTY (`ON_TRIP` sadece sistem atar) |

#### Kopma

- **Sürücü** → bağlantısız, müsaitlik silinir (ON_TRIP hariç), AppState=BACKGROUND
- **Müşteri** → inaktif, AppState=BACKGROUND

### Veritabanları

#### MongoDB (tek veritabanı, iki servis paylaşır)

Her iki servis de **aynı MongoDB**'ye bağlanır, ancak farklı koleksiyonları kullanır:

- **Main API koleksiyonları:** Trip, Payment, PaymentMethod, Campaign, CampaignUsage, Notification, AdminUser, DriverWeeklyEarnings, Penalty, TripCostSummary
- **User Service koleksiyonları:** Customer, Driver, Vehicle, Address, OTP

> Main API, User Service koleksiyonlarına doğrudan erişmez — HTTP ile gider.

#### Redis/Valkey

| Amaç | Key | TTL |
|------|-----|-----|
| Konum | `location:{userId}` | 15dk |
| Sürücü bağlantı | `driver:connected:{id}` | 30dk |
| Müsaitlik | `driver:availability:{id}` | — |
| App state | `driver:app-state:{id}` | — |
| Aktif trip | `active-trip:{userId}` | — |
| Session | `active-session:{userId}:{deviceId}` | — |
| Geo index | `nearby-users:{DRIVER}` | — |

## Dizin Yapısı

```
src/
├── main.ts                  # Boot
├── app.module.ts            # Root module
├── config/                  # Env config + Docker secrets
├── common/                  # Enum, DTO, util
├── jwt/                     # JWT service + guards (REST & WS)
├── redis/services/          # Konum, durum, session, nearby arama, aktif trip
├── queue/processors/        # BullMQ: trip-request, trip-timeout
├── websocket/               # Gateway + service + Redis adapter
├── clients/                 # User Service HTTP istemcileri (auth, customer, driver, maps)
├── events/                  # EventEmitter handlers
├── s3/                      # Dosya yükleme (DigitalOcean Spaces)
├── logger/                  # Winston + request logging
├── lock/                    # Distributed lock (Redis)
└── modules/
    ├── auth/                # OTP kayıt/giriş (User Service proxy)
    ├── admin/               # Admin panel (7 controller)
    ├── trip/                # Trip lifecycle (ana iş mantığı)
    ├── payments/            # Stripe ödeme + webhook
    ├── customers/           # Müşteri profil (User Service proxy)
    ├── drivers/             # Sürücü profil + haftalık kazanç
    ├── campaigns/           # Kampanya/indirim sistemi
    ├── notifications/       # Uygulama içi bildirimler
    ├── expo-notifications/  # Push bildirim (Expo SDK)
    ├── sms/                 # OTP SMS gönderimi
    ├── event/               # Event delivery (WS vs Push seçimi)
    ├── location/            # REST konum güncelleme
    ├── content/             # SSS, banka listesi
    ├── support-tickets/     # Destek talebi
    ├── common/              # App config, versiyon kontrolü
    └── health/              # Liveness, readiness, WS health
```