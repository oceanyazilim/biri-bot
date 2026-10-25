# Biri — Geçici Ses Odaları & Auto Guard

**Biri**, iki sistemi tek botta birleştiren bir Discord botudur:

1. **Geçici Ses Odaları:** `➕・Oda Oluştur` kanalına katılan herkese kişisel bir ses odası açar. Oda sahibi odasını komutlarla veya etkileşimli panelle yönetir.
2. **Biri Guard (Anti-Nuke):** Yönetim işlemlerini denetim kaydı (Audit Log) üzerinden izler. Toplu kanal/rol silme, toplu yasaklama gibi saldırıları algılar. Aktif modda, doğrulanmış saldırganın **botun yönetebildiği rollerini** otomatik olarak alır.

Tüm kullanıcı mesajları Türkçedir. Kod ve teknik dokümantasyon İngilizcedir.

---

## İçindekiler

- [Özellikler](#özellikler)
- [Gereksinimler](#gereksinimler)
- [1. Discord uygulamasını oluşturma](#1-discord-uygulamasını-oluşturma)
- [2. Botu sunucuya davet etme](#2-botu-sunucuya-davet-etme)
- [3. Kurulum](#3-kurulum)
- [4. Sunucuda ilk ayarlar](#4-sunucuda-ilk-ayarlar)
- [Komutlar](#komutlar)
- [Guard nasıl karar verir?](#guard-nasıl-karar-verir)
- [Üretim ortamı](#üretim-ortamı)
- [Testler](#testler)
- [Mimari](#mimari)
- [Sorun giderme](#sorun-giderme)
- [Bilinen sınırlar](#bilinen-sınırlar)

---

## Özellikler

**Geçici ses**
- Kullanıcının sunucu takma adıyla Türkçe iyelik ekli oda adı (`Emirhan'ın Odası`, `Ayşe'nin Odası`)
- Üye başına aktif oda sınırı (varsayılan 1); aynı anda katılan kullanıcılarda yarış durumu oluşmaz
- Boş oda, ayarlanabilir gecikmeyle silinir; biri geri dönerse silme iptal edilir
- Sahip ayrılınca bekleme süresi sonunda sahiplik, odada en uzun süredir bulunan kişiye geçer
- Kilitleme, gizleme, limit, isim, odaya özel engel/izin, sahiplik devri
- Etkileşimli yönetim paneli (`/odam`): butonlar, kullanıcı seçme menüleri, ayar penceresi
- Bot yeniden başlarsa oda durumu veritabanından kurtarılır
- Kalıcı kanallar asla silinmez: yalnızca veritabanında kayıtlı geçici odalar silinir
- Oda sahiplerine **hiçbir sunucu geneli yetki verilmez**. `/at` yalnızca sesten çıkarır, sunucudan atmaz.

**Guard**
- 10 modül: kanal silme/oluşturma, rol silme/oluşturma, yetki yükseltme, toplu yasaklama, toplu atma (prune dahil), webhook, bot ekleme, sunucu ayarları
- Her modül için ayarlanabilir uyarı ve kritik eşik, zaman penceresi, risk seviyesi ve otomatik rol alma
- Üç koruma modu: **İzleme**, **Uyarı**, **Aktif**. Aktif mod yalnızca onaylı bir komutla açılır.
- Güvenilir kullanıcı, rol ve bot listesi. Sunucu sahibi kalıcı olarak muaftır.
- Rol alınmadan önce rol listesinin anlık görüntüsü kaydedilir. `/guard-iade` ile onaylı iade yapılır; yetkili roller için ayrıca onay istenir.
- Korumalı log kategorisi ve 8 log kanalı oluşturur. Silinen log kanalları, döngü korumasıyla yeniden oluşturulur.
- Tüm olaylar veritabanında saklanır. Discord'a gönderim başarısız olsa bile kayıt kaybolmaz.

---

## Gereksinimler

- **Node.js 20.11+** (22 LTS önerilir)
- **PostgreSQL 14+** (üretim) veya yerel geliştirme için SQLite (ek kurulum gerekmez)
- Bir Discord hesabı ve botu ekleyebileceğiniz bir sunucu

---

## 1. Discord uygulamasını oluşturma

1. <https://discord.com/developers/applications> adresine gidin → **New Application** → adı **Biri** yapın.
2. **General Information** sayfasındaki **Application ID** değerini kopyalayın → `.env` içindeki `DISCORD_CLIENT_ID`.
3. Sol menüden **Bot** sekmesine gidin:
   - **Reset Token** → token'ı kopyalayın → `.env` içindeki `DISCORD_TOKEN`. *Token'ı kimseyle paylaşmayın.*
   - **Privileged Gateway Intents**:
     - *Message Content Intent*: **kapalı kalsın** (gerekmez).
     - *Server Members Intent*: isteğe bağlıdır. Açarsanız `.env` içinde `ENABLE_GUILD_MEMBERS_INTENT=true` yapın. Üye katılma/ayrılma logları ve atma (kick) olayları için ek doğrulama sağlar.
     - *Presence Intent*: kapalı kalsın.
   - **Public Bot** seçeneğini, botu yalnızca siz ekleyecekseniz kapatabilirsiniz.

Biri'nin kullandığı Gateway Intent'leri: `Guilds`, `GuildVoiceStates`, `GuildModeration` (denetim kaydı olayları ve yasaklamalar için). `GuildMembers` yalnızca yukarıdaki ayar açıksa kullanılır.

---

## 2. Botu sunucuya davet etme

Aşağıdaki bağlantıda `CLIENT_ID` yerine uygulama kimliğinizi yazın:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=286346384
```

`286346384` değeri yalnızca gereken izinleri içerir:

| İzin | Neden |
|---|---|
| Kanalları Görüntüle | Kanalları görmek |
| Kanalları Yönet | Oda ve log kanallarını oluşturmak/silmek, yeniden adlandırmak |
| Rolleri Yönet | Oda izinlerini (kanal izinleri) düzenlemek, Guard rol alma/iade |
| Üyeleri Taşı | Oda sahibini odasına taşımak, `/at` ile sesten çıkarmak |
| Bağlan | Ses kanallarına erişim |
| Mesaj Gönder, Bağlantı Yerleştir, Mesaj Geçmişini Oku | Log ve bilgilendirme mesajları |
| Denetim Kaydını Görüntüle | Guard'ın işlemi kimin yaptığını belirlemesi |

> **Yönetici (Administrator) izni vermeyin.** Biri buna ihtiyaç duymaz.

### ⚠️ Rol sıralaması (önemli)

Discord, bir botun yalnızca **kendi en yüksek rolünün altındaki** rolleri yönetmesine izin verir. Guard'ın bir saldırganın rollerini alabilmesi için:

**Sunucu Ayarları → Roller** bölümünde **Biri** rolünü, yönetici/moderatör rollerinin **üstüne**, olabildiğince yukarı sürükleyin.

`/guard-kur` ve `/guard-durum` komutları, botun üzerinde kalan yetkili rolleri tespit edip uyarır.

---

## 3. Kurulum

```bash
git clone <depo-adresi> biri
cd biri
npm install                 # bağımlılıklar + Prisma istemcisi (postinstall)
cp .env.example .env        # Windows: copy .env.example .env
```

`.env` dosyasında en az `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` ve `DATABASE_URL` değerlerini doldurun. Geliştirme sırasında komutların anında görünmesi için `DEV_GUILD_ID` olarak test sunucunuzun kimliğini yazın.

### A) Hızlı yerel geliştirme (SQLite)

```bash
# .env:  DATABASE_URL=file:./dev.db
npm run db:sqlite           # SQLite şemasını üretir, istemciyi oluşturur, tabloları kurar
npm run dev                 # tsx watch ile başlatır
```

> SQLite yolu `prisma/sqlite/` klasörüne göre çözülür. Bu yüzden değer tam olarak `file:./dev.db` olmalıdır.
> `npm install` veya `npm run db:generate` istemciyi PostgreSQL'e geri çevirir. SQLite'a dönmek için `npm run db:sqlite` komutunu tekrar çalıştırın.

### B) PostgreSQL ile geliştirme

```bash
# .env:  DATABASE_URL=postgresql://kullanici:sifre@localhost:5432/biri?schema=public
npm run db:migrate:deploy   # migration'ları uygular
npm run dev
```

Şemayı değiştirirseniz yeni bir migration oluşturmak için `npm run db:migrate:dev` komutunu kullanın.

### Komut kaydı

`AUTO_DEPLOY_COMMANDS=true` (varsayılan) ise komutlar her başlangıçta kaydedilir. Elle kaydetmek için:

```bash
npm run deploy-commands
```

`DEV_GUILD_ID` doluysa komutlar o sunucuya anında kaydedilir. Boşsa global kaydedilir; yayılmaları bir saate kadar sürebilir.

---

## 4. Sunucuda ilk ayarlar

> **Kısa yol:** Sunucu sahibi `/auto-setup` çalıştırırsa aşağıdaki 1. ve 2. adımlar tek seferde yapılır.

1. **Geçici ses:** `/kur` komutunu çalıştırın (*Sunucuyu Yönet* yetkisi gerekir). Biri, `🔊 BİRİ SES ODALARI` kategorisini ve `➕・Oda Oluştur` kanalını oluşturur ya da mevcut olanları kullanır. İsteğe bağlı seçenekler: silme gecikmesi, devir süresi, üye başına oda sayısı, varsayılan limit, mevcut kategori.
2. **Guard:** Sunucu sahibi `/guard-kur` komutunu çalıştırır. `🛡️ BİRİ・GÜVENLİK` kategorisi ve 8 log kanalı oluşturulur. Guard **Uyarı** modunda açılır.
3. Gerekirse güvenilir botları ve kişileri ekleyin: `/guard-guvenilir-ekle`.
4. Ayarlar hazır olunca `/guard-mod mod:Aktif` komutunu çalıştırıp onay düğmesine basın. Otomatik rol alma bundan sonra devreye girer.
5. Sunucu sahibi, Guard'ı yönetebilecek yöneticileri `/guard-yetkili ekle` ile belirleyebilir.

---

## Komutlar

### Oda komutları (herkes; yalnızca kendi odası için)

| Komut | Açıklama |
|---|---|
| `/odam` | Etkileşimli oda yönetim paneli |
| `/oda` | Bulunduğun odanın bilgileri |
| `/kilit` · `/ac` | Yeni katılımı engelle / izin ver (içerdekiler kalır) |
| `/gizle` · `/goster` | Odayı sıradan üyelerden gizle / göster |
| `/limit sayi` · `/limitsiz` | Kullanıcı limiti |
| `/isim yeni-isim` | Odayı yeniden adlandır (Discord sınırı: 10 dakikada 2 kez) |
| `/at @kullanici` | Kullanıcıyı **ses odasından** çıkarır. Sunucudan atmaz. |
| `/engelle` · `/engel-kaldir` | Odaya özel engel (sunucu yasağı değildir) |
| `/izin-ver` · `/izin-kaldir` | Kilitli/gizli odaya özel erişim |
| `/devret @kullanici` | Sahipliği odadaki birine devret |
| `/oda-sil` | Onay alarak odayı kapat |

*Kanalları Yönet* yetkisine sahip yetkililer, bulundukları odayı sahibi gibi yönetebilir.

### Guard komutları (Yönetici)

| Komut | Yetki | Açıklama |
|---|---|---|
| `/guard-kur` | Guard yöneticisi | Log kanallarını oluştur, Guard'ı aç |
| `/guard-ac` · `/guard-kapat` | Guard yöneticisi | Guard'ı aç / kapat |
| `/guard-durum` | Yönetici | Modüller, mod, son olay, uyarılar |
| `/guard-mod` | Guard yöneticisi | İzleme / Uyarı / Aktif (Aktif onay ister) |
| `/guard-esik` | Guard yöneticisi | Modül eşikleri ve pencere |
| `/guard-modul` | Guard yöneticisi | Modülü aç/kapat, otomatik rol alma, seviye |
| `/guard-ayar` | Guard yöneticisi | Bildirim rolleri, sahibe bildirim, olay bekleme, kayıt saklama |
| `/guard-guvenilir-ekle` · `-cikar` | Guard yöneticisi | Güvenilir kullanıcı/bot/rol |
| `/guard-guvenilir-liste` | Yönetici | Güvenilir liste |
| `/guard-yetkili ekle/cikar/liste` | **Sunucu sahibi** | Guard yöneticilerini belirle |
| `/guard-olaylar` | Yönetici | Son güvenlik olayları |
| `/guard-iade @kullanici` | Guard yöneticisi | Alınan rolleri onayla geri ver |

**Guard yöneticisi** sunucu sahibi ya da sahibin `/guard-yetkili` ile yetkilendirdiği bir yöneticidir. Sıradan moderatörler güvenilir listeyi değiştiremez. Guard yöneticileri de kendilerini ya da sahip oldukları bir rolü güvenilir listeye ekleyemez.

### Diğer

| Komut | Açıklama |
|---|---|
| `/auto-setup` | **Tek seferde kurulum:** ses kategorisi + `➕・Oda Oluştur` kanalı, güvenlik log kategorisi + 8 log kanalı, Guard açılır (Uyarı modunda). Tekrar çalıştırmak güvenlidir. |
| `/kur` | Yalnızca geçici ses sistemini kur / ayarlarını güncelle |
| `/yardim` | Komut listesi |

### Varsayılan eşikler

| Modül | Uyarı (YÜKSEK) | Kritik | Pencere | Otomatik rol alma |
|---|---|---|---|---|
| Kanal Silme | 3 | 5 | 10 sn | ✅ |
| Kanal Oluşturma | 5 | 8 | 15 sn | ✅ |
| Rol Silme | 2 | 3 | 10 sn | ✅ |
| Rol Oluşturma | 5 | 8 | 15 sn | ✅ |
| Yetki Yükseltme | — | 1 | 60 sn | ❌ (açıkça açılmalı) |
| Toplu Yasaklama | 2 | 3 | 15 sn | ✅ |
| Toplu Atma | 3 | 4 | 15 sn | ✅ |
| Webhook | 3 | 5 | 15 sn | ✅ |
| Bot Ekleme | — | 3 | 60 sn | ❌ |
| Sunucu Ayarları | 3 | 5 | 30 sn | ❌ |

---

## Guard nasıl karar verir?

```
Gateway olayı ─► Denetim kaydı eşleştirme ─► Normalleştirme ─► Sorumlu doğrulama
   ─► Güvenilir kontrolü ─► Eşik değerlendirme ─► Risk sınıflandırma
   ─► Veritabanına kayıt ─► Koruma politikası ─► İzleme │ Uyarı │ Aktif
                                                     └► Rol görüntüsü ─► Rol alma ─► Olay raporu
```

**Otomatik rol alma için aşağıdakilerin hepsi sağlanmalıdır:**

- Sorumlu kişi, eşleşen bir denetim kaydıyla **doğrulanmış** olmalı. Belirsiz ya da bulunamayan kayıtlarda olay "doğrulanmadı" olarak loglanır ve yaptırım uygulanmaz.
- Kişi sunucu sahibi değil, güvenilir listede değil ve güvenilir bir role sahip değil.
- İşlemi yapan Biri değil. Biri'nin kendi işlemleri (oda açma/silme, log kanalları) her zaman hariç tutulur.
- Modül açık, kritik eşik aşılmış, mod **Aktif** ve modülde otomatik rol alma açık.
- Aynı kişi için bekleme süresi içinde açılmış bir olay yok. Aynı saldırı iki kez cezalandırılmaz.

**Eşleştirme:** Birincil kaynak `guildAuditLogEntryCreate` olayıdır. Bir kanal silindiğinde eşleşen kayıt gelmezse kısa bir beklemeden sonra denetim kaydı sorgulanır. Eşleştirme sunucu, işlem türü, hedef kimliği ve zaman damgasına göre yapılır; "en son kayıt" körü körüne kullanılmaz. Aynı hedef için farklı kişilere ait kayıtlar varsa olay **belirsiz** sayılır. Aynı sunucu ve işlem türü için eşzamanlı sorgular tek API isteğinde birleştirilir.

**Rol alma:** Önce kullanıcının tüm rolleri kaydedilir. Ardından botun yönetebildiği roller tek istekle alınır. Bu istek başarısız olursa roller tek tek alınır. Botun üstündeki roller ve entegrasyon (managed) rolleri olduğu gibi kalır. Rapor neyin alınıp neyin alınamadığını nedeniyle birlikte dürüstçe gösterir. Veritabanı erişilemezse koruma yine uygulanır ve alınan rol kimlikleri Discord raporuna yazılır.

**İade:** `/guard-iade` kayıtlı görüntüyü gösterir. "Güvenli iade" yalnızca yetkisiz rolleri geri verir. Yönetici gibi yetkili roller yalnızca "Yetkili Roller Dahil" düğmesiyle ve bilinçli onayla iade edilir. Silinmiş ya da botun veremediği roller atlanır.

---

## Üretim ortamı

```bash
npm ci                      # postinstall Prisma istemcisini oluşturur
npm run db:migrate:deploy   # migration'ları uygula
npm run build               # TypeScript → dist/
NODE_ENV=production npm start
```

- Uzun süreli çalıştırma için **PM2** (`pm2 start dist/index.js --name biri`) ya da bir **systemd** servisi kullanın.
- `HEALTH_PORT=8080` ayarlanırsa `GET /health` adresi bot ve veritabanı durumunu JSON olarak döner. Durum `ok` ise 200, değilse 503 döner.
- `SIGINT`/`SIGTERM` sinyallerinde zamanlayıcılar durdurulur, bekleyen loglar gönderilir, Discord ve veritabanı bağlantıları kapatılır.
- Loglar Pino ile JSON formatında yazılır. Geliştirmede `pino-pretty` ile renkli gösterilir.

### Dokploy ile yayınlama

Projede hazır bir `Dockerfile` var. Konteyner açılırken önce `prisma migrate deploy` ile veritabanı tablolarını kurar/günceller, ardından botu başlatır.

1. **Project** oluşturun → **Create Service → Database → PostgreSQL**. Deploy edin ve **Internal Connection URL** değerini kopyalayın.
2. Aynı projede **Create Service → Application** oluşturun. Kaynak olarak GitHub deposunu ve dalı seçin. **Build Type: Dockerfile** (yol `Dockerfile`, context `.`).
3. **Environment** sekmesine şunları girin: `NODE_ENV=production`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL` (1. adımdaki dahili adres), `AUTO_DEPLOY_COMMANDS=true`.
4. Domain veya port gerekmez; Biri bir web sitesi değildir. **Deploy** edin.
5. **Logs** sekmesinde `Veritabanı bağlantısı kuruldu`, `Slash komutları kaydedildi` ve `Biri hazır` satırlarını görmelisiniz.
6. **Replica sayısını 1'de tutun.** Eşik sayaçları bellek içindedir.
7. Güncelleme için GitHub'a push edip **Redeploy** yapın ya da Auto Deploy'u açın. Migration'lar otomatik uygulanır.

---

## Testler

```bash
npm test             # 121 test
npm run typecheck    # kaynak + test tip kontrolü
npm run check        # ikisi birden
```

Testler Discord API'sini taklit eder (`tests/fakes`). Rol hiyerarşisi, yönetilen roller, izinler ve ses bağlantıları gerçekçi şekilde modellenir. Kapsanan senaryolar:

eşzamanlı oda oluşturma · sahibin ayrılması · otomatik oda silme ve iptali · sahiplik devri (eşzamanlı devirde tek kazanan) · yetkisiz oda yönetimi · `/at` komutunun yalnızca sesten çıkarması · oda yetkilerinin sunucu geneli yetki vermemesi · eşik tespiti · güvenilir ve sahip muafiyeti · belirsiz denetim kaydı · yanlış alarm önleme · Biri'nin kendi işlemleri · toplu kanal ve rol silme · otomatik rol alma · hiyerarşi kaynaklı kısmi başarısızlık · rol iadesi · yeniden başlatma sonrası kurtarma · eksik yetkiler · tekrarlanan denetim olayları · çoklu sunucu izolasyonu · veritabanı kesintisi · log kanalı kurtarma döngüsü koruması

---

## Mimari

```
src/
├── commands/          voice/ · guard/ · admin/  (32 slash komutu)
├── components/        Panel düğmeleri, menüler, modallar, onay ekranları
├── events/            voice/ · guild/ · security/  (gateway olay işleyicileri)
├── modules/
│   ├── tempVoice/     TempVoiceService (yaşam döngüsü), RoomManager (işlemler),
│   │                  roomPermissions (izin hesaplama), roomNaming, panel
│   ├── guard/
│   │   ├── detectors/     Modül başına denetim kaydı dedektörleri, ThresholdTracker
│   │   ├── attribution/   AuditLogCorrelator
│   │   ├── policies/      ProtectionPolicy
│   │   ├── enforcement/   RoleStripper, IncidentManager
│   │   ├── recovery/      RoleRestorer
│   │   └── SecurityEventProcessor, GuardService, GuardReporter, TrustService
│   └── logging/       LogChannelService (kur/kurtar), LogDispatcher (hız sınırlı toplu gönderim)
├── services/          SelfActionRegistry, Cooldown, Health, komut kaydı
├── database/          Prisma istemcisi ve repository'ler
├── core/              Bağımlılık konteyneri (createApp)
└── index.ts           Başlatma ve düzgün kapatma
prisma/                schema.prisma + migrations/ (PostgreSQL)
tests/                 Vitest senaryoları ve Discord taklitleri
```

Veritabanı tabloları: `GuildConfig`, `TempVoiceConfig`, `TempVoiceRoom`, `RoomMemberRestriction`, `RoomAllowedMember`, `GuardConfig`, `GuardModuleConfig`, `TrustedExecutor`, `GuardManager`, `SecurityEvent`, `SecurityIncident`, `SecurityIncidentRoleSnapshot`, `LogChannelConfig`, `CommandAuditLog`.

---

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Komutlar görünmüyor | `DEV_GUILD_ID` ayarlayın ya da global kayıt için bekleyin. `npm run deploy-commands` çalıştırın. |
| `Ortam değişkenleri geçersiz` | `.env` içindeki eksik veya hatalı alanlar hatada listelenir. |
| Oda oluşmuyor | Sistem log kanalına bakın. Genelde *Kanalları Yönet*, *Rolleri Yönet* veya *Üyeleri Taşı* izni eksiktir. |
| Guard rol alamıyor | Biri rolünü rol listesinde yukarı taşıyın. `/guard-durum` ile uyarılara bakın. |
| Olaylar "doğrulanmadı" görünüyor | Bota *Denetim Kaydını Görüntüle* izni verin. |
| SQLite `Unable to open the database file` | `DATABASE_URL=file:./dev.db` kullanın (yol `prisma/sqlite/` klasörüne göredir). |
| `Prisma` sağlayıcı uyuşmazlığı | PostgreSQL için `npm run db:generate`, SQLite için `npm run db:sqlite` çalıştırın. |

---

## Bilinen sınırlar

- Eşik sayaçları ve zamanlayıcılar **bellek içindedir** ve tek işlem (tek shard) için tasarlanmıştır. Her sunucu yalnızca bir shard'a bağlı olduğundan sharding ile de doğru çalışır. Ancak aynı sunucuyu dinleyen iki ayrı bot süreci çalıştırmayın. Kalıcı kayıtlar ve tekrar önleme veritabanındadır.
- Discord, webhook üzerinden gönderilen mesajlar için güvenilir bir "gönderen kişi" sağlamaz. Biri yalnızca webhook **yönetim** işlemlerini (oluşturma/düzenleme/silme) değerlendirir.
- Botun rolünün üzerindeki rollere ve sunucu sahibine Discord gereği yaptırım uygulanamaz. Bu durumlar raporda açıkça belirtilir ve yöneticilere iletilir.
- Kanal adı değişikliği Discord tarafından kanal başına 10 dakikada 2 kez ile sınırlıdır.
