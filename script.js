"use strict";

/* =====================================
   NurPoput — JavaScript
   Работа с API и базой данных
   ===================================== */

const $ = (selector) => document.querySelector(selector);

const cities = [
  "Бишкек",
  "Ош",
  "Каракол",
  "Токмок",
  "Джалал-Абад",
  "Нарын",
  "Талас",
  "Баткен",
  "Чолпон-Ата",
  "Балыкчы",
  "Кант",
  "Кызыл-Кия",
  "Кара-Балта",
  "Узген",
  "Кочкор",
  "Ат-Башы",
];

let authMode = "login"; // login | register | phone
let currentUser = null;
let phoneStage = "request"; // request | verify
let phoneNeedName = false;
let forgotStage = "request"; // request | reset
let currentChatBookingId = null;
let chatTimer = null;
let pendingChatBookingId = null;
let parcelsLoaded = false;

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

// =====================================
// Единая облачная база данных (CloudSync)
// Данные синхронизируются в реальном времени между всеми смартфонами и ПК!
// =====================================
const CloudSync = {
  isSyncing: false,
  lastSyncTime: 0,

  async get(key, defaultValue = null) {
    try {
      const res = await fetch(`/api/sync?key=${encodeURIComponent(key)}`);
      if (!res.ok) return defaultValue;
      const json = await res.json();
      return json && json.ok && json.data !== undefined ? json.data : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  async push(key, value) {
    try {
      await fetch(`/api/sync?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      });
    } catch (e) {
      console.warn("Cloud push error:", e);
    }
  },

  async pullAll() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      // 1. Поездки (Rides)
      const remoteDeleted = await this.get("nurpoput_deleted_rides");
      if (Array.isArray(remoteDeleted)) {
        const localDel = LocalDB.get("deleted_ride_ids", []);
        const mergedDel = Array.from(new Set([...localDel, ...remoteDeleted]));
        LocalDB.set("deleted_ride_ids", mergedDel);
      }
      const deletedIds = new Set(LocalDB.get("deleted_ride_ids", []));

      const remoteRides = await this.get("nurpoput_rides");
      if (Array.isArray(remoteRides)) {
        const localRides = LocalDB.get("rides", []).filter(r => !deletedIds.has(r.id) && r.status !== "deleted");
        const rideMap = new Map();
        localRides.forEach(r => rideMap.set(r.id, r));
        remoteRides.forEach(r => {
          if (deletedIds.has(r.id) || r.status === "deleted") return;
          const ex = rideMap.get(r.id);
          if (!ex || (r.isVip && !ex.isVip) || (r.vipActivatedAt && !ex.vipActivatedAt) || (r.status === "archived" && ex.status !== "archived") || (r.seats !== ex.seats)) {
            rideMap.set(r.id, r);
          }
        });
        const mergedRides = Array.from(rideMap.values()).filter(r => !deletedIds.has(r.id));
        LocalDB.set("rides", mergedRides);
      }

      // 2. Посылки (Parcels)
      const remoteParcels = await this.get("nurpoput_parcels");
      if (Array.isArray(remoteParcels)) {
        const localParcels = LocalDB.get("parcels", []);
        const parcelMap = new Map();
        localParcels.forEach(p => parcelMap.set(p.id, p));
        remoteParcels.forEach(p => parcelMap.set(p.id, p));
        LocalDB.set("parcels", Array.from(parcelMap.values()));
      }

      // 3. Заявки на пополнение баланса (Topup Requests)
      const remoteTopups = await this.get("nurpoput_topups");
      if (Array.isArray(remoteTopups)) {
        const localTopups = LocalDB.get("topup_requests", []);
        const topupMap = new Map();
        localTopups.forEach(t => topupMap.set(t.id, t));
        remoteTopups.forEach(t => {
          // Серверный статус имеет приоритет (approved/rejected)
          topupMap.set(t.id, t);
        });
        LocalDB.set("topup_requests", Array.from(topupMap.values()));
      }

      // 4. Пользователи и балансы (Users & Balances)
      const remoteDeletedUsers = await this.get("nurpoput_deleted_users");
      if (Array.isArray(remoteDeletedUsers)) {
        const localDelUsers = LocalDB.get("deleted_user_ids", []);
        const mergedDelUsers = Array.from(new Set([...localDelUsers, ...remoteDeletedUsers]));
        LocalDB.set("deleted_user_ids", mergedDelUsers);
      }
      const deletedUserIds = new Set(LocalDB.get("deleted_user_ids", []));

      const remoteUsers = await this.get("nurpoput_users");
      if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
        const localUsers = LocalDB.get("users_v3", []).filter(u => !deletedUserIds.has(u.id));
        const userMap = new Map();
        localUsers.forEach(u => userMap.set(u.id, u));
        remoteUsers.forEach(u => {
          if (deletedUserIds.has(u.id)) return;
          if (u.id === 1 || u.role === "admin" || u.email === "nuri.kg133@gmail.com" || (u.name && (u.name.includes("Маматкалиев") || u.name.includes("Чынгыз") || u.name.includes("Чынгызбеков")))) {
            u.name = "Жаныбекова Нурпери";
            u.email = "nuri.kg133@gmail.com";
          }
          const ex = userMap.get(u.id);
          const backup = localStorage.getItem("user_avatar_" + u.id);
          const resolvedAvatar = u.avatar || ex?.avatar || backup || null;
          if (ex) {
            userMap.set(u.id, { ...ex, ...u, avatar: resolvedAvatar });
          } else {
            userMap.set(u.id, { ...u, avatar: resolvedAvatar });
          }
        });
        const mergedUsers = Array.from(userMap.values()).filter(u => !deletedUserIds.has(u.id));
        mergedUsers.forEach(u => {
          if (u.id === 1 || u.role === "admin" || u.email === "nuri.kg133@gmail.com" || (u.name && (u.name.includes("Маматкалиев") || u.name.includes("Чынгыз") || u.name.includes("Чынгызбеков")))) {
            u.name = "Жаныбекова Нурпери";
            u.email = "nuri.kg133@gmail.com";
          }
        });
        LocalDB.set("users_v3", mergedUsers);

        // Обновляем текущую сессию
        const sessionUser = LocalDB.get("session_user", null);
        if (sessionUser) {
          const fresh = mergedUsers.find(u => u.id === sessionUser.id);
          if (fresh) {
            sessionUser.balance = fresh.balance || 0;
            sessionUser.role = fresh.role || sessionUser.role;
            const backup = localStorage.getItem("user_avatar_" + sessionUser.id) || localStorage.getItem("nurpoput_saved_avatar");
            const finalAvatar = fresh.avatar || backup || sessionUser.avatar || null;
            sessionUser.avatar = finalAvatar;
            if (sessionUser.id === 1 || sessionUser.role === "admin" || sessionUser.email === "nuri.kg133@gmail.com" || (sessionUser.name && (sessionUser.name.includes("Маматкалиев") || sessionUser.name.includes("Чынгыз") || sessionUser.name.includes("Чынгызбеков")))) {
              sessionUser.name = "Жаныбекова Нурпери";
            }
            LocalDB.set("session_user", sessionUser);
            if (currentUser && currentUser.id === sessionUser.id) {
              currentUser.name = sessionUser.name;
              currentUser.balance = sessionUser.balance;
              currentUser.avatar = finalAvatar;
              const nameEl = $("#profileName");
              if (nameEl) nameEl.textContent = currentUser.name;
              const dispEl = $("#profileDisplayName");
              if (dispEl) dispEl.textContent = currentUser.name;
              const balEl = $("#profileBalanceValue");
              if (balEl) balEl.textContent = currentUser.balance;
              renderAvatar();
            }
          }
        }
      }

      // 5. Транзакции
      const remoteTransactions = await this.get("nurpoput_transactions");
      if (Array.isArray(remoteTransactions)) {
        const localTransactions = LocalDB.get("transactions", []);
        const trMap = new Map();
        localTransactions.forEach(t => trMap.set(t.id, t));
        remoteTransactions.forEach(t => trMap.set(t.id, t));
        LocalDB.set("transactions", Array.from(trMap.values()));
      }

      // 6. Заявки на поиск машины (Ride requests)
      const remoteRideRequests = await this.get("nurpoput_ride_requests");
      if (Array.isArray(remoteRideRequests)) {
        const localReqs = LocalDB.get("ride_requests", []);
        const reqMap = new Map();
        localReqs.forEach(r => reqMap.set(r.id, r));
        remoteRideRequests.forEach(r => reqMap.set(r.id, r));
        LocalDB.set("ride_requests", Array.from(reqMap.values()));
      }

      // 7. Бронирования (Bookings)
      const remoteBookings = await this.get("nurpoput_bookings");
      if (Array.isArray(remoteBookings)) {
        const localBookings = LocalDB.get("bookings", []);
        const bMap = new Map();
        localBookings.forEach(b => bMap.set(b.id, b));
        remoteBookings.forEach(b => bMap.set(b.id, b));
        LocalDB.set("bookings", Array.from(bMap.values()));
      }

      // 8. Уведомления (Notifications)
      const remoteNotifications = await this.get("nurpoput_notifications");
      if (Array.isArray(remoteNotifications)) {
        const localNotifs = LocalDB.get("notifications", []);
        const nMap = new Map();
        localNotifs.forEach(n => nMap.set(n.id, n));
        remoteNotifications.forEach(n => nMap.set(n.id, n));
        LocalDB.set("notifications", Array.from(nMap.values()));
      }

      this.lastSyncTime = Date.now();
    } catch (e) {
      console.warn("CloudSync error:", e);
    } finally {
      this.isSyncing = false;
    }
  }
};

// =====================================
// Автономный локальный движок базы данных (работает с CloudSync)
// =====================================
const LocalDB = {
  get(key, defaultValue) {
    try {
      const data = localStorage.getItem("nurpoput_" + key);
      return data !== null ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("nurpoput_" + key, JSON.stringify(value));
      // Автоматическая облачная синхронизация для общих данных
      if (["rides", "parcels", "topup_requests", "users_v3", "bookings", "transactions", "ride_requests", "notifications", "deleted_ride_ids", "deleted_user_ids"].includes(key)) {
        const cloudKey = "nurpoput_" + (key === "topup_requests" ? "topups" : (key === "users_v3" ? "users" : (key === "deleted_ride_ids" ? "deleted_rides" : (key === "deleted_user_ids" ? "deleted_users" : key))));
        CloudSync.push(cloudKey, value);
      }
    } catch {}
  },
  init() {
    // В базе остаётся профиль главного администратора
    if (!localStorage.getItem("nurpoput_users_v3")) {
      const initialUsers = [
        {
          id: 1,
          name: "Жаныбекова Нурпери",
          email: "nuri.kg133@gmail.com",
          phone: "+996700303133",
          role: "admin",
          showPhone: true,
          password: "password123",
          createdAt: new Date().toISOString()
        }
      ];
      this.set("users_v3", initialUsers);
      localStorage.removeItem("nurpoput_users");
      localStorage.removeItem("nurpoput_users_v2");
    }

    // Обновляем данные администратора на Жаныбекова Нурпери и устанавливаем честный баланс
    const deletedUserIds = new Set(this.get("deleted_user_ids", []));
    let users = this.get("users_v3", []).filter(u => !deletedUserIds.has(u.id));
    let modified = false;
    users.forEach(u => {
      if (u.role === "admin" || u.id === 1 || u.email === "nuri.kg133@gmail.com" || (u.name && (u.name.includes("Чынгыз") || u.name.includes("Маматкалиев")))) {
        u.name = "Жаныбекова Нурпери";
        u.email = "nuri.kg133@gmail.com";
        u.role = "admin";
        modified = true;
      }
      if (u.balance === undefined || u.balance === 500) {
        u.balance = 0;
        modified = true;
      }
    });
    const adminUser = users.find(u => u.role === "admin" || u.id === 1 || u.email === "nuri.kg133@gmail.com");
    if (adminUser) {
      adminUser.name = "Жаныбекова Нурпери";
      adminUser.email = "nuri.kg133@gmail.com";
      adminUser.role = "admin";
      modified = true;
    }
    if (modified) {
      this.set("users_v3", users);
    }
    const sessionUser = this.get("session_user", null);
    if (sessionUser) {
      if (deletedUserIds.has(sessionUser.id)) {
        this.set("session_user", null);
      } else {
        if (sessionUser.role === "admin" || sessionUser.id === 1 || sessionUser.email === "nuri.kg133@gmail.com" || (sessionUser.name && (sessionUser.name.includes("Чынгыз") || sessionUser.name.includes("Маматкалиев")))) {
          sessionUser.name = "Жаныбекова Нурпери";
          sessionUser.email = "nuri.kg133@gmail.com";
          sessionUser.role = "admin";
        }
        const dbUser = users.find(u => u.id === sessionUser.id);
        if (dbUser) {
          sessionUser.balance = dbUser.balance || 0;
          if (dbUser.avatar && !sessionUser.avatar) sessionUser.avatar = dbUser.avatar;
        }
        const backupAvatar = localStorage.getItem("user_avatar_" + sessionUser.id) || localStorage.getItem("nurpoput_saved_avatar");
        if (backupAvatar && !sessionUser.avatar) sessionUser.avatar = backupAvatar;
        this.set("session_user", sessionUser);
      }
    }

    // Реальные данные поездок: удаляем старые фиктивные записи (Toyota Camry, Honda CR-V)
    let rides = this.get("rides", []);
    rides = rides.filter(r => !(r.id === 1 && r.car === "Toyota Camry" && r.price === 1200) && !(r.id === 2 && r.car === "Honda CR-V" && r.price === 800));
    this.set("rides", rides);

    // Реальные данные посылок: удаляем старые фиктивные записи (Айбек, Гульнара)
    let parcels = this.get("parcels", []);
    parcels = parcels.filter(p => !(p.id === 1 && p.senderName === "Айбек") && !(p.id === 2 && p.senderName === "Гульнара"));
    this.set("parcels", parcels);

    // Запуск первичной облачной синхронизации
    CloudSync.pullAll();

    // Фоновая синхронизация каждые 7 секунд
    setInterval(async () => {
      await CloudSync.pullAll();
      if (typeof currentPage !== "undefined") {
        if (currentPage === "home" && typeof loadHomeContent === "function") {
          loadHomeContent();
        } else if (currentPage === "admin" && currentUser && currentUser.role === "admin" && typeof loadAdmin === "function") {
          loadAdmin();
        } else if (currentPage === "profile" && currentUser) {
          const freshUsers = LocalDB.get("users_v3", []);
          const me = freshUsers.find(u => u.id === currentUser.id);
          if (me && me.balance !== currentUser.balance) {
            currentUser.balance = me.balance || 0;
            const balEl = $("#profileBalanceValue");
            if (balEl) balEl.textContent = currentUser.balance;
          }
        }
      }
    }, 7000);
  }
};
LocalDB.init();

async function handleLocalApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  const body = options.body ? JSON.parse(options.body) : {};

  const users = LocalDB.get("users_v3", []);
  let sessionUser = LocalDB.get("session_user", null);

  // AUTH
  if (pathname === "/api/auth") {
    if (method === "GET") {
      return { user: sessionUser };
    }
  }

  if (pathname === "/api/auth/login") {
    const input = String(body.email || "").trim().toLowerCase();
    const cleanDigits = input.replace(/\D/g, "");
    const password = String(body.password || "");
    const user = users.find(u => {
      const matchEmail = u.email && u.email.toLowerCase() === input;
      const matchPhone = u.phone && (u.phone === input || (cleanDigits.length >= 9 && u.phone.replace(/\D/g, "") === cleanDigits));
      return (matchEmail || matchPhone) && u.password === password;
    });
    if (!user) {
      const err = new Error("Неверная почта (или телефон) или пароль.");
      err.status = 401;
      throw err;
    }
    const savedAvatar = user.avatar || localStorage.getItem("user_avatar_" + user.id) || localStorage.getItem("nurpoput_saved_avatar") || null;
    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      showPhone: user.showPhone,
      avatar: savedAvatar,
      avatarVersion: user.avatarVersion || 0,
      balance: user.balance || 0
    };
    LocalDB.set("session_user", publicUser);
    return { user: publicUser };
  }

  if (pathname === "/api/auth/register") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");

    if (name.length < 2) {
      const err = new Error("Имя должно быть не менее 2 символов.");
      err.status = 400;
      throw err;
    }
    if (!phone) {
      const err = new Error("Укажите номер телефона.");
      err.status = 400;
      throw err;
    }
    if (users.some(u => u.email === email)) {
      const err = new Error("Этот адрес электронной почты уже зарегистрирован.");
      err.status = 409;
      throw err;
    }
    if (users.some(u => u.phone === phone)) {
      const err = new Error("Этот номер телефона уже зарегистрирован.");
      err.status = 409;
      throw err;
    }

    const newUser = {
      id: Date.now(),
      name,
      email,
      phone,
      password,
      role: users.length === 0 ? "admin" : "user",
      showPhone: true,
      avatar: null,
      avatarVersion: 0,
      balance: 0,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    LocalDB.set("users_v3", users);

    const publicUser = {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      role: newUser.role,
      showPhone: newUser.showPhone,
      avatar: null,
      avatarVersion: 0,
      balance: 0
    };
    LocalDB.set("session_user", publicUser);
    return { user: publicUser };
  }

  if (pathname === "/api/auth/logout") {
    LocalDB.set("session_user", null);
    return { ok: true };
  }

  if (pathname === "/api/auth/forgot") {
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const user = users.find(u => u.email === email && (u.phone === phone || u.phone?.replace(/\D/g, "") === phone.replace(/\D/g, "")));
    if (!user) {
      const err = new Error("Аккаунт с такой почтой и номером телефона не найден.");
      err.status = 404;
      throw err;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    LocalDB.set("reset_pending", { userId: user.id, code, expires: Date.now() + 1800000 });

    // Создаём уведомление в аккаунте
    try {
      const notifications = LocalDB.get("notifications", []);
      notifications.unshift({
        id: Date.now(),
        userId: user.id,
        type: "password_reset",
        title: "🔑 Код для восстановления пароля",
        message: `Ваш код для восстановления пароля: ${code}. Никому не сообщайте его. Срок действия: 30 минут.`,
        createdAt: new Date().toISOString(),
        read: false
      });
      LocalDB.set("notifications", notifications);
    } catch (e) {}

    // Отправляем через EmailJS, если подключен
    let emailSent = false;
    try {
      if (typeof sendPasswordResetEmail === "function") {
        emailSent = await sendPasswordResetEmail(user.email, code, user.name || "Пользователь");
      }
    } catch (e) {}

    console.info(`[NurPoput Mailer] Код восстановления для ${user.email}: ${code}`);

    return {
      ok: true,
      email: user.email,
      emailSent: Boolean(emailSent),
      code: emailSent ? undefined : code,
      message: emailSent
        ? `Код подтверждения отправлен на вашу электронную почту ${user.email}.`
        : `Код восстановления: ${code}`
    };
  }

  if (pathname === "/api/auth/phone/request") {
    const phone = String(body.phone || "").trim();
    const cleanDigits = phone.replace(/\D/g, "");
    if (!phone || cleanDigits.length < 9) {
      const err = new Error("Введите корректный номер телефона.");
      err.status = 400;
      throw err;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    LocalDB.set("phone_login_pending", { phone, cleanDigits, code, expires: Date.now() + 600000 });
    return {
      ok: true,
      directCode: code,
      message: `Код подтверждения для номера ${phone}: ${code}. (Для отправки реальных СМС на сотовые номера КР требуется платный СМС-шлюз).`
    };
  }

  if (pathname === "/api/auth/phone/verify") {
    const phone = String(body.phone || "").trim();
    const cleanDigits = phone.replace(/\D/g, "");
    const code = String(body.code || "").trim();
    const pending = LocalDB.get("phone_login_pending", null);
    if (!pending || pending.code !== code || (pending.cleanDigits !== cleanDigits && pending.phone !== phone) || Date.now() > pending.expires) {
      const err = new Error("Неверный код или срок действия истёк.");
      err.status = 400;
      throw err;
    }

    let user = users.find(u => u.phone === phone || (cleanDigits.length >= 9 && u.phone && u.phone.replace(/\D/g, "") === cleanDigits));
    if (!user) {
      if (!body.name) {
        const err = new Error("Новый номер: укажите имя.");
        err.status = 400;
        err.data = { needName: true };
        throw err;
      }
      user = {
        id: Date.now(),
        name: String(body.name).trim(),
        email: `user_${Date.now()}@nurpoput.kg`,
        phone,
        password: "phone_auth_" + Date.now(),
        role: "user",
        showPhone: true,
        avatar: null,
        avatarVersion: 0,
        balance: 0,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      LocalDB.set("users_v3", users);
    }

    const savedAvatar = user.avatar || localStorage.getItem("user_avatar_" + user.id) || localStorage.getItem("nurpoput_saved_avatar") || null;
    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      showPhone: user.showPhone,
      avatar: savedAvatar,
      avatarVersion: user.avatarVersion || 0,
      balance: user.balance || 0
    };
    LocalDB.set("session_user", publicUser);
    LocalDB.set("phone_login_pending", null);
    return { ok: true, user: publicUser, message: "Вход успешно выполнен!" };
  }

  if (pathname === "/api/auth/delete-account" && method === "POST") {
    if (!sessionUser) {
      const err = new Error("Сначала войдите в аккаунт.");
      err.status = 401;
      throw err;
    }
    const targetId = sessionUser.id;
    const deletedUserIds = LocalDB.get("deleted_user_ids", []);
    if (!deletedUserIds.includes(targetId)) deletedUserIds.push(targetId);
    LocalDB.set("deleted_user_ids", deletedUserIds);

    const remaining = users.filter(u => u.id !== targetId);
    LocalDB.set("users_v3", remaining);

    const rides = LocalDB.get("rides", []);
    const remainingRides = rides.filter(r => r.driverId !== targetId);
    LocalDB.set("rides", remainingRides);

    LocalDB.set("session_user", null);
    try {
      localStorage.removeItem("user_avatar_" + targetId);
      localStorage.removeItem("nurpoput_saved_avatar");
    } catch (e) {}

    return { ok: true, message: "Ваш аккаунт и все связанные с ним поездки успешно удалены." };
  }

  if (pathname === "/api/auth/reset") {
    const code = String(body.code || "").trim();
    const password = String(body.password || "");
    const pending = LocalDB.get("reset_pending", null);
    if (!pending || pending.code !== code || Date.now() > pending.expires) {
      const err = new Error("Неверный код или срок действия истёк.");
      err.status = 400;
      throw err;
    }
    const user = users.find(u => u.id === pending.userId);
    if (user) {
      user.password = password;
      LocalDB.set("users_v3", users);
      const savedAvatar = user.avatar || localStorage.getItem("user_avatar_" + user.id) || localStorage.getItem("nurpoput_saved_avatar") || null;
      const publicUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        showPhone: user.showPhone,
        avatar: savedAvatar,
        avatarVersion: user.avatarVersion || 0,
        balance: user.balance || 0
      };
      LocalDB.set("session_user", publicUser);
      LocalDB.set("reset_pending", null);
      return { user: publicUser, message: "Пароль успешно обновлён!" };
    }
    const err = new Error("Пользователь не найден.");
    err.status = 404;
    throw err;
  }

  // RIDES
  if (pathname === "/api/rides") {
    const rides = LocalDB.get("rides", []);
    if (method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const date = url.searchParams.get("date");
      const passengers = Number(url.searchParams.get("passengers") || 1);
      const carClass = url.searchParams.get("carClass");

      let filtered = rides.filter(r => (r.status === "published" || !r.status) && (Number(r.seats) || 0) > 0);
      if (from) filtered = filtered.filter(r => r.fromCity === from);
      if (to) filtered = filtered.filter(r => r.toCity === to);
      if (date) filtered = filtered.filter(r => r.date === date);
      if (passengers > 1) filtered = filtered.filter(r => (Number(r.seats) || 0) >= passengers);
      if (carClass) filtered = filtered.filter(r => r.carClass === carClass);

      // Сортировка: сначала VIP-поездки, затем новые по дате
      filtered.sort((a, b) => {
        const aVip = a.isVip ? 1 : 0;
        const bVip = b.isVip ? 1 : 0;
        if (aVip !== bVip) return bVip - aVip;
        return (b.vipActivatedAt || b.createdAt || 0) > (a.vipActivatedAt || a.createdAt || 0) ? 1 : -1;
      });
      return { rides: filtered };
    }
    if (method === "POST") {
      if (!sessionUser) {
        const err = new Error("Сначала войдите в аккаунт.");
        err.status = 401;
        throw err;
      }
      
      const carBrand = String(body.carBrand || "").trim();
      const carModel = String(body.carModel || "").trim();
      const carName = body.car || [carBrand, carModel].filter(Boolean).join(" ") || "Автомобиль";
      const carClass = String(body.carClass || "comfort").toLowerCase();
      const carColor = String(body.carColor || "Белый").trim();
      const carPlate = String(body.carPlate || "").trim().toUpperCase();
      const seatsCount = Math.max(1, Number(body.seats || 1));
      const priceVal = Math.max(0, Number(body.price || 0));

      const wantVip = Boolean(body.isVip);
      let isVipActive = false;
      let vipActivatedAt = null;

      if (wantVip) {
        const driverUser = users.find(u => u.id === sessionUser.id);
        const VIP_PRICE = 50;
        if (!driverUser || (driverUser.balance || 0) < VIP_PRICE) {
          const err = new Error(`Для отметки VIP требуется ${VIP_PRICE} сом на балансе. Текущий баланс: ${driverUser?.balance || 0} сом. Пополните баланс в профиле или снимите отметку VIP.`);
          err.status = 402;
          err.needTopup = true;
          throw err;
        }
        driverUser.balance = (driverUser.balance || 0) - VIP_PRICE;
        sessionUser.balance = driverUser.balance;
        isVipActive = true;
        vipActivatedAt = new Date().toISOString();

        const transactions = LocalDB.get("transactions", []);
        transactions.unshift({
          id: Date.now() + 1,
          userId: driverUser.id,
          userName: driverUser.name,
          type: "vip_boost",
          amount: VIP_PRICE,
          description: `VIP-статус при публикации поездки (${body.from} ➔ ${body.to})`,
          createdAt: new Date().toISOString()
        });
        LocalDB.set("transactions", transactions);
        LocalDB.set("users_v3", users);
        LocalDB.set("session_user", sessionUser);
      }

      // Все базовые публикации бесплатны!
      const newRide = {
        id: Date.now(),
        driverId: sessionUser.id,
        driverName: sessionUser.name,
        fromCity: body.from,
        toCity: body.to,
        date: body.date,
        time: body.time,
        seats: seatsCount,
        price: priceVal,
        car: carName,
        carBrand,
        carModel,
        carColor,
        carPlate,
        carClass,
        phone: body.phone,
        comment: body.comment || "",
        status: "published",
        isVip: isVipActive,
        vipActivatedAt,
        createdAt: new Date().toISOString()
      };
      rides.unshift(newRide);
      LocalDB.set("rides", rides);

      // Автоматическое уведомление пассажиров, оставивших заявку на поиск машины
      try {
        const rideRequests = LocalDB.get("ride_requests", []);
        const notifications = LocalDB.get("notifications", []);
        let matchFound = false;

        rideRequests.forEach(req => {
          if (req.status === "active" &&
              req.fromCity === newRide.fromCity &&
              req.toCity === newRide.toCity &&
              (!req.date || req.date === newRide.date) &&
              (!req.carClass || req.carClass === newRide.carClass) &&
              newRide.seats >= (req.passengers || 1)) {
            
            req.status = "matched";
            matchFound = true;

            notifications.unshift({
              id: Date.now() + Math.floor(Math.random() * 1000),
              userId: req.passengerId,
              passengerPhone: req.passengerPhone,
              type: "ride_matched",
              title: "🎉 Найдена подходящая машина!",
              message: `Водитель ${newRide.driverName} (тел: ${newRide.phone}) опубликовал поездку ${newRide.fromCity} ➔ ${newRide.toCity} на ${newRide.date} в ${newRide.time}. Авто: ${carName} (${carPlate || "номер не указан"}), класс: ${carClass}, мест: ${newRide.seats}, цена: ${newRide.price} сом.`,
              rideId: newRide.id,
              createdAt: new Date().toISOString(),
              read: false
            });
          }
        });

        if (matchFound) {
          LocalDB.set("ride_requests", rideRequests);
          LocalDB.set("notifications", notifications);
        }
      } catch (e) {
        console.warn("Match notification error:", e);
      }

      return { ride: newRide };
    }
    if (method === "DELETE") {
      if (!sessionUser) {
        const err = new Error("Требуется вход.");
        err.status = 401;
        throw err;
      }
      const rideId = Number(body.rideId);
      const ride = rides.find(r => r.id === rideId);
      if (!ride) {
        const err = new Error("Поездка не найдена.");
        err.status = 404;
        throw err;
      }
      if (ride.driverId !== sessionUser.id && sessionUser.role !== "admin") {
        const err = new Error("Вы можете удалять только свою поездку.");
        err.status = 403;
        throw err;
      }
      const deletedIds = LocalDB.get("deleted_ride_ids", []);
      if (!deletedIds.includes(rideId)) deletedIds.push(rideId);
      LocalDB.set("deleted_ride_ids", deletedIds);

      const remaining = rides.filter(r => r.id !== rideId);
      LocalDB.set("rides", remaining);
      return { ok: true, message: "Поездка удалена." };
    }
  }

  // АРХИВАЦИЯ ПОЕЗДКИ ВОДИТЕЛЕМ (КОГДА НАШЕЛ КЛИЕНТОВ)
  if (pathname === "/api/rides/archive" && method === "POST") {
    if (!sessionUser) {
      const err = new Error("Требуется вход.");
      err.status = 401;
      throw err;
    }
    const rideId = Number(body.rideId);
    const rides = LocalDB.get("rides", []);
    const ride = rides.find(r => r.id === rideId);
    if (!ride) {
      const err = new Error("Поездка не найдена.");
      err.status = 404;
      throw err;
    }
    if (ride.driverId !== sessionUser.id && sessionUser.role !== "admin") {
      const err = new Error("Вы можете завершать только свою поездку.");
      err.status = 403;
      throw err;
    }
    ride.status = "archived";
    ride.archivedAt = new Date().toISOString();
    LocalDB.set("rides", rides);
    return { ok: true, ride, message: "Поездка завершена и перемещена в архив!" };
  }

  // ЗАЯВКИ ПАССАЖИРОВ НА ПОИСК МАШИНЫ
  if (pathname === "/api/ride-requests") {
    const requests = LocalDB.get("ride_requests", []);
    if (method === "GET") {
      return { requests };
    }
    if (method === "POST") {
      const fromCity = String(body.from || "").trim();
      const toCity = String(body.to || "").trim();
      const dateVal = String(body.date || "").trim();
      const phoneVal = String(body.phone || (sessionUser ? sessionUser.phone : "")).trim();

      if (!fromCity || !toCity) {
        const err = new Error("Укажите маршрут поездки (откуда и куда).");
        err.status = 400;
        throw err;
      }
      if (!phoneVal) {
        const err = new Error("Укажите номер телефона для связи.");
        err.status = 400;
        throw err;
      }

      const newReq = {
        id: Date.now(),
        passengerId: sessionUser ? sessionUser.id : null,
        passengerName: sessionUser ? sessionUser.name : "Пассажир",
        passengerPhone: phoneVal,
        fromCity,
        toCity,
        date: dateVal,
        time: body.time || "",
        passengers: Number(body.passengers || 1),
        carClass: body.carClass || "",
        status: "active",
        createdAt: new Date().toISOString()
      };

      requests.unshift(newReq);
      LocalDB.set("ride_requests", requests);

      return {
        ok: true,
        request: newReq,
        message: "Заявка сохранена! Мы уведомим вас сразу, как только появится подходящая машина."
      };
    }
  }

  // PARCELS
  if (pathname === "/api/parcels/search") {
    const parcels = LocalDB.get("parcels", []);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const date = url.searchParams.get("date");
    let filtered = parcels.filter(p => p.status === "open");
    if (from) filtered = filtered.filter(p => p.fromCity === from);
    if (to) filtered = filtered.filter(p => p.toCity === to);
    if (date) filtered = filtered.filter(p => p.date === date);
    // Сортировка: сначала VIP-посылки, затем обычные
    filtered.sort((a, b) => {
      const aVip = a.isVip ? 1 : 0;
      const bVip = b.isVip ? 1 : 0;
      if (aVip !== bVip) return bVip - aVip;
      return (b.vipActivatedAt || b.createdAt || 0) > (a.vipActivatedAt || a.createdAt || 0) ? 1 : -1;
    });
    return { parcels: filtered };
  }

  if (pathname === "/api/parcels/take") {
    if (!sessionUser) {
      const err = new Error("Сначала войдите в аккаунт.");
      err.status = 401;
      throw err;
    }
    const parcelId = Number(body.parcelId);
    const parcels = LocalDB.get("parcels", []);
    const parcel = parcels.find(p => p.id === parcelId);
    if (!parcel) {
      const err = new Error("Посылка не найдена.");
      err.status = 404;
      throw err;
    }
    if (parcel.ownerId === sessionUser.id) {
      const err = new Error("Нельзя взять заказ на свою же посылку.");
      err.status = 400;
      throw err;
    }
    parcel.status = "in_progress";
    parcel.driverId = sessionUser.id;
    parcel.driverName = sessionUser.name;
    LocalDB.set("parcels", parcels);

    return {
      ok: true,
      message: "Заказ принят! Телефон отправителя: " + parcel.senderPhone + " (" + parcel.senderName + "), телефон получателя: " + parcel.recipientPhone + " (" + parcel.recipientName + ").",
      parcel
    };
  }

  if (pathname === "/api/parcels") {
    const parcels = LocalDB.get("parcels", []);
    if (method === "GET") {
      let filtered = parcels.filter(p => p.status === "open");
      filtered.sort((a, b) => {
        const aVip = a.isVip ? 1 : 0;
        const bVip = b.isVip ? 1 : 0;
        if (aVip !== bVip) return bVip - aVip;
        return (b.vipActivatedAt || b.createdAt || 0) > (a.vipActivatedAt || a.createdAt || 0) ? 1 : -1;
      });
      return { parcels: filtered };
    }
    if (method === "POST") {
      if (!sessionUser) {
        const err = new Error("Сначала войдите в аккаунт.");
        err.status = 401;
        throw err;
      }
      // Все публикации бесплатны!
      const newParcel = {
        id: Date.now(),
        ownerId: sessionUser.id,
        ownerName: sessionUser.name,
        fromCity: body.from,
        toCity: body.to,
        senderName: body.senderName,
        senderPhone: body.senderPhone,
        recipientName: body.recipientName,
        recipientPhone: body.recipientPhone,
        date: body.date,
        size: body.size,
        description: body.description || "",
        status: "open",
        isVip: false,
        createdAt: new Date().toISOString()
      };
      parcels.unshift(newParcel);
      LocalDB.set("parcels", parcels);
      return { parcel: newParcel };
    }
  }

  // BOOKINGS
  if (pathname === "/api/bookings") {
    const bookings = LocalDB.get("bookings", []);
    const rides = LocalDB.get("rides", []);
    if (method === "GET") {
      if (!sessionUser) return { bookings: [] };
      return { bookings: bookings.filter(b => b.passengerId === sessionUser.id) };
    }
    if (method === "POST") {
      if (!sessionUser) {
        const err = new Error("Сначала войдите в аккаунт.");
        err.status = 401;
        throw err;
      }
      const rideId = Number(body.rideId);
      const ride = rides.find(r => r.id === rideId);
      if (!ride) {
        const err = new Error("Поездка не найдена.");
        err.status = 404;
        throw err;
      }
      const seats = Math.max(1, Number(body.seats || 1));
      if ((ride.seats || 0) < seats) {
        const err = new Error(`Недостаточно мест. Доступно только ${ride.seats || 0} мест(о).`);
        err.status = 409;
        throw err;
      }
      ride.seats -= seats;
      if (ride.seats <= 0) {
        ride.seats = 0;
        ride.status = "full"; // Автоматически закрываем поездку при 0 мест
      }
      LocalDB.set("rides", rides);

      const totalPrice = (ride.price || 0) * seats;
      const newBooking = {
        id: Date.now(),
        rideId,
        ride,
        passengerId: sessionUser.id,
        passengerName: sessionUser.name,
        passengerPhone: sessionUser.phone || "",
        seats,
        totalPrice,
        status: "confirmed",
        createdAt: new Date().toISOString()
      };
      bookings.unshift(newBooking);
      LocalDB.set("bookings", bookings);

      // Уведомление водителю
      try {
        const notifications = LocalDB.get("notifications", []);
        notifications.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          userId: ride.driverId,
          type: "new_booking",
          title: "💺 Новое бронирование мест!",
          message: `Пассажир ${sessionUser.name} (тел: ${sessionUser.phone || "в профиле"}) забронировал ${seats} мест(о) на поездку ${ride.fromCity} ➔ ${ride.toCity} (итого к оплате водителю: ${totalPrice} сом). Осталось свободных мест: ${ride.seats}.`,
          bookingId: newBooking.id,
          rideId: ride.id,
          createdAt: new Date().toISOString(),
          read: false
        });
        LocalDB.set("notifications", notifications);
      } catch (e) {}

      return {
        booking: newBooking,
        message: `Успешно забронировано ${seats} мест(о)! Итого к оплате водителю: ${totalPrice} сом. Телефон водителя: ${ride.phone}`
      };
    }
  }

  // AVATAR
  if (pathname === "/api/avatar") {
    if (!sessionUser) {
      const err = new Error("Сначала войдите в аккаунт.");
      err.status = 401;
      throw err;
    }
    if (method === "POST") {
      const dataUrl = body.dataUrl;
      sessionUser.avatar = dataUrl;
      sessionUser.avatarVersion = (sessionUser.avatarVersion || 0) + 1;
      try {
        localStorage.setItem("user_avatar_" + sessionUser.id, dataUrl);
        localStorage.setItem("nurpoput_saved_avatar", dataUrl);
      } catch (e) {}
      const user = users.find(u => u.id === sessionUser.id);
      if (user) {
        user.avatar = dataUrl;
        user.avatarVersion = sessionUser.avatarVersion;
        LocalDB.set("users_v3", users);
      }
      LocalDB.set("session_user", sessionUser);
      return { ok: true, user: sessionUser };
    }
    if (method === "DELETE") {
      sessionUser.avatar = null;
      sessionUser.avatarVersion = (sessionUser.avatarVersion || 0) + 1;
      try {
        localStorage.removeItem("user_avatar_" + sessionUser.id);
        localStorage.removeItem("nurpoput_saved_avatar");
      } catch (e) {}
      const user = users.find(u => u.id === sessionUser.id);
      if (user) {
        user.avatar = null;
        user.avatarVersion = sessionUser.avatarVersion;
        LocalDB.set("users_v3", users);
      }
      LocalDB.set("session_user", sessionUser);
      return { ok: true, user: sessionUser };
    }
  }

  // BALANCE: ЗАЯВКА НА ПОПОЛНЕНИЕ БАЛАНСА (РЕАЛЬНЫЕ ДЕНЬГИ ЧЕРЕЗ MBANK)
  if (pathname === "/api/balance/topup-request") {
    if (!sessionUser) {
      const err = new Error("Сначала войдите в аккаунт.");
      err.status = 401;
      throw err;
    }
    const amount = Number(body.amount);
    if (!amount || amount < 10) {
      const err = new Error("Минимальная сумма пополнения — 10 сом.");
      err.status = 400;
      throw err;
    }
    const senderInfo = String(body.senderInfo || "").trim();
    if (!senderInfo || senderInfo.length < 2) {
      const err = new Error("Укажите номер телефона или имя из перевода в MBank / О!Деньги.");
      err.status = 400;
      throw err;
    }

    const bank = String(body.bank || "MBank");
    const receipt = body.receipt || null;

    const topupRequests = LocalDB.get("topup_requests", []);
    const newRequest = {
      id: Date.now(),
      userId: sessionUser.id,
      userName: sessionUser.name,
      userPhone: sessionUser.phone || "",
      amount,
      senderInfo,
      bank,
      receipt,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    topupRequests.unshift(newRequest);
    LocalDB.set("topup_requests", topupRequests);

    // ВАЖНО: Баланс НЕ увеличивается автоматически!
    // Зачисление происходит ТОЛЬКО после того, как администратор проверит чек и нажмет "Зачислить" в админке.
    return {
      ok: true,
      requestId: newRequest.id,
      message: `Заявка на ${amount} сом принята и отправлена администратору! Чек прикреплен. После проверки поступления в ${bank} средства зачислятся на ваш баланс.`
    };
  }

  // VIP BOOST: ПОДНЯТИЕ В ТОП ЗА 50 СОМ
  if (pathname === "/api/vip/boost") {
    if (!sessionUser) {
      const err = new Error("Сначала войдите в аккаунт.");
      err.status = 401;
      throw err;
    }
    const VIP_PRICE = 50;
    const user = users.find(u => u.id === sessionUser.id);
    if (!user) {
      const err = new Error("Пользователь не найден.");
      err.status = 404;
      throw err;
    }
    if ((user.balance || 0) < VIP_PRICE) {
      const err = new Error(`Недостаточно средств на балансе. Для поднятия в VIP требуется ${VIP_PRICE} сом. Текущий баланс: ${user.balance || 0} сом.`);
      err.status = 402;
      err.needTopup = true;
      throw err;
    }

    const transactions = LocalDB.get("transactions", []);

    if (body.rideId) {
      const rideId = Number(body.rideId);
      const rides = LocalDB.get("rides", []);
      const ride = rides.find(r => r.id === rideId);
      if (!ride) {
        const err = new Error("Поездка не найдена.");
        err.status = 404;
        throw err;
      }
      if (ride.driverId !== user.id && user.role !== "admin") {
        const err = new Error("Вы можете поднять в VIP только свою поездку.");
        err.status = 403;
        throw err;
      }
      user.balance = (user.balance || 0) - VIP_PRICE;
      sessionUser.balance = user.balance;
      ride.isVip = true;
      ride.vipActivatedAt = new Date().toISOString();

      transactions.unshift({
        id: Date.now(),
        userId: user.id,
        userName: user.name,
        type: "vip_boost",
        amount: VIP_PRICE,
        targetType: "ride",
        targetId: ride.id,
        description: `Поднятие поездки в VIP (${ride.fromCity} ➔ ${ride.toCity})`,
        createdAt: new Date().toISOString()
      });

      LocalDB.set("rides", rides);
      LocalDB.set("users_v3", users);
      LocalDB.set("session_user", sessionUser);
      LocalDB.set("transactions", transactions);

      return {
        ok: true,
        balance: user.balance,
        message: "Поездка успешно поднята в топ (VIP)! Пассажиры увидят её первой в поиске."
      };
    }

    if (body.parcelId) {
      const parcelId = Number(body.parcelId);
      const parcels = LocalDB.get("parcels", []);
      const parcel = parcels.find(p => p.id === parcelId);
      if (!parcel) {
        const err = new Error("Заявка на посылку не найдена.");
        err.status = 404;
        throw err;
      }
      if (parcel.ownerId !== user.id && user.role !== "admin") {
        const err = new Error("Вы можете поднять в VIP только свою посылку.");
        err.status = 403;
        throw err;
      }
      user.balance = (user.balance || 0) - VIP_PRICE;
      sessionUser.balance = user.balance;
      parcel.isVip = true;
      parcel.vipActivatedAt = new Date().toISOString();

      transactions.unshift({
        id: Date.now(),
        userId: user.id,
        userName: user.name,
        type: "vip_boost",
        amount: VIP_PRICE,
        targetType: "parcel",
        targetId: parcel.id,
        description: `Поднятие посылки в VIP (${parcel.fromCity} ➔ ${parcel.toCity})`,
        createdAt: new Date().toISOString()
      });

      LocalDB.set("parcels", parcels);
      LocalDB.set("users_v3", users);
      LocalDB.set("session_user", sessionUser);
      LocalDB.set("transactions", transactions);

      return {
        ok: true,
        balance: user.balance,
        message: "Заказ на посылку успешно поднят в топ (VIP)!"
      };
    }

    const err = new Error("Не указана поездка или посылка для поднятия в VIP.");
    err.status = 400;
    throw err;
  }

  // PROFILE
  if (pathname === "/api/profile") {
    if (!sessionUser) {
      const err = new Error("Требуется вход.");
      err.status = 401;
      throw err;
    }

    const user = users.find(u => u.id === sessionUser.id);
    if (user) {
      sessionUser.balance = user.balance !== undefined ? user.balance : (sessionUser.balance || 0);
    }

    if (method === "PATCH" || method === "POST") {
      if (user) {
        if (body.name) {
          user.name = String(body.name).trim();
          sessionUser.name = user.name;
        }
        if (body.email) {
          const newEmail = String(body.email).trim().toLowerCase();
          if (users.some(u => u.id !== user.id && u.email === newEmail)) {
            const err = new Error("Этот email уже занят другим пользователем.");
            err.status = 409;
            throw err;
          }
          user.email = newEmail;
          sessionUser.email = newEmail;
        }
        if (body.phone) {
          const newPhone = String(body.phone).trim();
          if (users.some(u => u.id !== user.id && u.phone === newPhone)) {
            const err = new Error("Этот телефон уже занят другим пользователем.");
            err.status = 409;
            throw err;
          }
          user.phone = newPhone;
          sessionUser.phone = newPhone;
        }
        if (body.password) {
          const newPass = String(body.password);
          if (newPass.length < 6) {
            const err = new Error("Пароль должен быть не менее 6 знаков.");
            err.status = 400;
            throw err;
          }
          user.password = newPass;
        }
        LocalDB.set("users_v3", users);
        LocalDB.set("session_user", sessionUser);
      }
      return { ok: true, user: sessionUser, message: "Данные профиля успешно обновлены!" };
    }

    const rides = LocalDB.get("rides", []).filter(r => r.driverId === sessionUser.id);
    const bookings = LocalDB.get("bookings", []).filter(b => b.passengerId === sessionUser.id);
    const driverBookings = LocalDB.get("bookings", []).filter(b => b.ride && b.ride.driverId === sessionUser.id);
    const parcels = LocalDB.get("parcels", []).filter(p => p.ownerId === sessionUser.id);

    const allRequests = LocalDB.get("topup_requests", []);
    const pendingTopups = allRequests.filter(r => r.userId === sessionUser.id && r.status === "pending");

    return {
      user: sessionUser,
      rides,
      bookings,
      driverBookings,
      parcels,
      pendingTopups
    };
  }

  // ADMIN
  if (pathname === "/api/admin") {
    if (!sessionUser || sessionUser.role !== "admin") {
      const err = new Error("Доступ только для администратора.");
      err.status = 403;
      throw err;
    }

    const rides = LocalDB.get("rides", []);
    const parcels = LocalDB.get("parcels", []);
    const bookings = LocalDB.get("bookings", []);
    const transactions = LocalDB.get("transactions", []);
    const topupRequests = LocalDB.get("topup_requests", []);

    // Подтверждение реального платежа администратором
    if (method === "POST" && body.action === "approve_topup") {
      const requestId = Number(body.requestId);
      const req = topupRequests.find(r => r.id === requestId);
      if (!req) {
        const err = new Error("Заявка не найдена.");
        err.status = 404;
        throw err;
      }
      if (req.status !== "pending") {
        const err = new Error("Эта заявка уже была обработана ранее.");
        err.status = 400;
        throw err;
      }
      req.status = "approved";
      req.approvedAt = new Date().toISOString();
      LocalDB.set("topup_requests", topupRequests);

      const targetUser = users.find(u => u.id === req.userId);
      if (targetUser) {
        targetUser.balance = (targetUser.balance || 0) + req.amount;
        LocalDB.set("users_v3", users);
        if (sessionUser.id === targetUser.id) {
          sessionUser.balance = targetUser.balance;
          LocalDB.set("session_user", sessionUser);
        }
      }

      transactions.unshift({
        id: Date.now(),
        userId: req.userId,
        userName: req.userName,
        type: "topup",
        amount: req.amount,
        description: `Зачисление реальных средств через MBank (чек/номер: ${req.senderInfo})`,
        createdAt: new Date().toISOString()
      });
      LocalDB.set("transactions", transactions);

      return {
        ok: true,
        message: `Платеж подтверждён! Зачислено ${req.amount} сом пользователю ${req.userName}.`
      };
    }

    // Отклонение заявки (деньги не поступили в банк)
    if (method === "POST" && body.action === "reject_topup") {
      const requestId = Number(body.requestId);
      const req = topupRequests.find(r => r.id === requestId);
      if (!req) {
        const err = new Error("Заявка не найдена.");
        err.status = 404;
        throw err;
      }
      req.status = "rejected";
      req.rejectedAt = new Date().toISOString();
      LocalDB.set("topup_requests", topupRequests);

      return {
        ok: true,
        message: "Заявка отклонена. Деньги на баланс не зачислены."
      };
    }

    // Ручное пополнение баланса администратором
    if (method === "POST" && body.action === "adjust_balance") {
      const targetId = Number(body.userId);
      const addAmount = Number(body.amount);
      const targetUser = users.find(u => u.id === targetId);
      if (targetUser) {
        targetUser.balance = (targetUser.balance || 0) + addAmount;
        LocalDB.set("users_v3", users);
        if (sessionUser.id === targetId) {
          sessionUser.balance = targetUser.balance;
          LocalDB.set("session_user", sessionUser);
        }
        transactions.unshift({
          id: Date.now(),
          userId: targetUser.id,
          userName: targetUser.name,
          type: "topup",
          amount: addAmount,
          description: `Ручное пополнение администратором (+${addAmount} сом)`,
          createdAt: new Date().toISOString()
        });
        LocalDB.set("transactions", transactions);
        return { ok: true, balance: targetUser.balance, message: `Баланс ${targetUser.name} успешно изменён на ${addAmount} сом!` };
      }
      const err = new Error("Пользователь не найден.");
      err.status = 404;
      throw err;
    }

    if (method === "DELETE") {
      if (body.userId) {
        const targetId = Number(body.userId);
        const deletedUserIds = LocalDB.get("deleted_user_ids", []);
        if (!deletedUserIds.includes(targetId)) deletedUserIds.push(targetId);
        LocalDB.set("deleted_user_ids", deletedUserIds);

        const remaining = users.filter(u => u.id !== targetId);
        LocalDB.set("users_v3", remaining);

        const remainingRides = rides.filter(r => r.driverId !== targetId);
        LocalDB.set("rides", remainingRides);

        if (sessionUser && sessionUser.id === targetId) {
          LocalDB.set("session_user", null);
          try {
            localStorage.removeItem("user_avatar_" + targetId);
            localStorage.removeItem("nurpoput_saved_avatar");
          } catch (e) {}
          return { ok: true, isSelf: true, message: "Ваш аккаунт администратора успешно удалён." };
        }
        return { ok: true, message: "Пользователь успешно и навсегда удалён из системы." };
      }
      if (body.rideId) {
        const targetId = Number(body.rideId);
        const deletedIds = LocalDB.get("deleted_ride_ids", []);
        if (!deletedIds.includes(targetId)) deletedIds.push(targetId);
        LocalDB.set("deleted_ride_ids", deletedIds);

        const remaining = rides.filter(r => r.id !== targetId);
        LocalDB.set("rides", remaining);
        return { ok: true, message: "Поездка навсегда удалена администратором." };
      }
      if (body.parcelId) {
        const targetId = Number(body.parcelId);
        const remaining = parcels.filter(p => p.id !== targetId);
        LocalDB.set("parcels", remaining);
        return { ok: true, message: "Заказ на посылку удалён администратором." };
      }
      if (body.bookingId) {
        const targetId = Number(body.bookingId);
        const remaining = bookings.filter(b => b.id !== targetId);
        LocalDB.set("bookings", remaining);
        return { ok: true, message: "Бронирование удалено администратором." };
      }
    }

    // Все публикации бесплатны. Доход формируется от поднятий в VIP (50 сом)
    const vipTx = transactions.filter(t => t.type === "vip_boost");
    const vipCount = vipTx.length;
    const vipIncome = vipTx.reduce((sum, t) => sum + (t.amount || 0), 0);
    const topupTx = transactions.filter(t => t.type === "topup");
    const totalTopup = topupTx.reduce((sum, t) => sum + (t.amount || 0), 0);

    const pendingTopupsCount = topupRequests.filter(r => r.status === "pending").length;

    return {
      stats: {
        users: users.length,
        rides: rides.length,
        parcels: parcels.length,
        bookings: bookings.length,
        vipCount,
        vipIncome,
        totalTopup,
        pendingTopupsCount
      },
      users,
      rides,
      parcels,
      bookings,
      transactions,
      topupRequests
    };
  }

  // NOTIFICATIONS
  if (pathname === "/api/notifications") {
    const notifications = LocalDB.get("notifications", []);
    if (!sessionUser) return { notifications: [] };
    const myNotifs = notifications.filter(n => !n.userId || n.userId === sessionUser.id || (sessionUser.phone && n.passengerPhone && n.passengerPhone.replace(/\D/g, "") === sessionUser.phone.replace(/\D/g, "")));
    return { notifications: myNotifs };
  }

  return {};
}

async function api(path, options = {}) {
  // Для прямых обращений к облачной базе данных
  if (path.startsWith("/api/sync")) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (response.ok) return await response.json();
    throw new Error("Ошибка связи с облаком");
  }

  // Все операции обрабатываются через автономный движок с моментальной облачной синхронизацией CloudSync
  return handleLocalApi(path, options);
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function setMessage(selector, message, isError = false) {
  const element = $(selector);
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#c0392b" : "#087f5b";
}

function handleAuthError(error) {
  if (error?.status === 401) {
    currentUser = null;
    stopChatPolling();
    updateAccountButton();
    showPage("auth");
    return true;
  }
  return false;
}

function setMinimumDates() {
  const today = new Date();
  const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .split("T")[0];

  ["#searchDate", "#publishDate", "#parcelDate", "#parcelSearchDate"].forEach(
    (selector) => {
      const input = $(selector);
      if (input) {
        input.min = localDate;
      }
    },
  );
}

function fillCitySelects() {
  const selectors = [
    "#homeSearchFrom",
    "#homeSearchTo",
    "#searchFrom",
    "#searchTo",
    "#publishFrom",
    "#publishTo",
    "#parcelFrom",
    "#parcelTo",
    "#parcelSearchFrom",
    "#parcelSearchTo",
    "#reqFromCity",
    "#reqToCity",
  ];

  selectors.forEach((selector) => {
    const select = $(selector);
    if (!select) return;

    select.innerHTML = "";
    if (selector.startsWith("#home") || selector.startsWith("#search") || selector.startsWith("#parcelSearch") || selector.startsWith("#req")) {
      const defOpt = document.createElement("option");
      defOpt.value = "";
      defOpt.textContent = currentLang === "kg" ? "— Шаарды тандаңыз —" : "— Выберите город —";
      select.appendChild(defOpt);
    }

    cities.forEach((city) => {
      const option = document.createElement("option");
      option.value = city;
      option.textContent = city;
      select.appendChild(option);
    });
  });
}

/* =====================================
   ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ
   ===================================== */

const pageIds = {
  home: "homePage",
  auth: "authPage",
  forgot: "forgotPage",
  find: "findPage",
  publish: "publishPage",
  parcels: "parcelsPage",
  safety: "safetyPage",
  messages: "messagesPage",
  profile: "profilePage",
  admin: "adminPage",
};

function stopChatPolling() {
  if (chatTimer) {
    clearInterval(chatTimer);
    chatTimer = null;
  }
}

function showPage(pageName) {
  stopChatPolling();
  currentChatBookingId = null;

  if (
    (pageName === "profile" || pageName === "messages") &&
    !currentUser
  ) {
    pageName = "auth";
  }

  if (pageName === "admin") {
    if (currentUser?.role === "admin") {
      loadAdmin();
    } else {
      showToast("Доступ к панели есть только у администратора.");
      pageName = currentUser ? "profile" : "auth";
    }
  }

  const targetId = pageIds[pageName];

  if (!targetId) {
    pageName = "home";
  }

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });

  const target = $("#" + pageIds[pageName]);
  if (target) {
    target.classList.add("active");
  }

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageName);
  });

  $("#navigation")?.classList.remove("open");

  if (pageName === "home") {
    loadHomeContent();
  }

  if (pageName === "profile" && currentUser) {
    loadProfile();
  }

  if (pageName === "messages" && currentUser) {
    if (pendingChatBookingId) {
      const bookingId = pendingChatBookingId;
      pendingChatBookingId = null;
      openChat(bookingId);
    } else {
      showThreadList();
    }
  }

  if (pageName === "parcels" && !parcelsLoaded) {
    parcelsLoaded = true;
    loadParcelResults("");
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");

  if (pageButton) {
    event.preventDefault();
    showPage(pageButton.dataset.page);
  }
});

document.addEventListener("click", (event) => {
  const chatButton = event.target.closest("[data-chat-booking]");

  if (chatButton) {
    if (!currentUser) {
      showToast("Сначала войди в аккаунт.");
      showPage("auth");
      return;
    }
    const bookingId = Number(chatButton.dataset.chatBooking);
    if (Number.isInteger(bookingId) && bookingId > 0) {
      pendingChatBookingId = bookingId;
      showPage("messages");
    }
  }
});

$("#menuButton")?.addEventListener("click", () => {
  $("#navigation")?.classList.toggle("open");
});

/* =====================================
   ВХОД И РЕГИСТРАЦИЯ
   ===================================== */

function setAuthMode(mode) {
  authMode = mode;

  document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authTab === mode);
  });

  const isRegister = mode === "register";

  $("#nameLabel")?.classList.toggle("hidden", !isRegister);
  $("#authName")?.classList.toggle("hidden", !isRegister);
  if ($("#authName")) {
    $("#authName").required = isRegister;
  }

  $("#phoneLabel")?.classList.toggle("hidden", !isRegister);
  $("#authPhone")?.classList.toggle("hidden", !isRegister);
  if ($("#authPhone")) {
    $("#authPhone").required = isRegister;
  }

  if ($("#authPassword")) {
    $("#authPassword").autocomplete = isRegister
      ? "new-password"
      : "current-password";
  }

  if ($("#authSubmit")) {
    $("#authSubmit").textContent = isRegister
      ? "Создать аккаунт"
      : "Войти";
  }

  setMessage("#authMessage", "");
}

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    setAuthMode(tab.dataset.authTab);
  });
});

$("#accountButton")?.addEventListener("click", () => {
  if (currentUser) {
    showPage("profile");
  } else {
    setAuthMode("login");
    showPage("auth");
  }
});

$("#authForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("#authEmail").value.trim().toLowerCase();
  const password = $("#authPassword").value;
  const name = $("#authName") ? $("#authName").value.trim() : "";
  const phone = $("#authPhone") ? $("#authPhone").value.trim() : "";

  if (!email || !password) {
    setMessage("#authMessage", "Заполни все обязательные поля.", true);
    return;
  }

  if (password.length < 6) {
    setMessage(
      "#authMessage",
      "Пароль должен содержать минимум 6 символов.",
      true,
    );
    return;
  }

  if (authMode === "register") {
    if (name.length < 2) {
      setMessage("#authMessage", "Введи имя длиной не менее 2 символов.", true);
      return;
    }
    if (!phone) {
      setMessage("#authMessage", "Введи номер телефона для регистрации.", true);
      return;
    }
  }

  try {
    const data = await api("/api/auth/" + authMode, {
      method: "POST",
      body: JSON.stringify({ email, password, name, phone }),
    });

    finishLogin(data.user);
  } catch (error) {
    setMessage("#authMessage", error.message, true);
  }
});

function finishLogin(user, message) {
  currentUser = user;
  const backup = localStorage.getItem("user_avatar_" + user.id) || localStorage.getItem("nurpoput_saved_avatar");
  if (!currentUser.avatar && backup) currentUser.avatar = backup;
  updateAccountButton();
  renderAvatar();

  $("#authForm")?.reset();
  resetPhoneForm();
  resetForgotForm();
  setMessage("#authMessage", "");
  setMessage("#phoneMessage", "");

  showPage("home");
  showToast(message || "Добро пожаловать в NurPoput, " + user.name + "!");
  refreshBadges();
}

function updateAccountButton() {
  const button = $("#accountButton");

  if (button) {
    button.textContent = currentUser
      ? (currentLang === "kg" ? "Жеке кабинет" : "Мой профиль")
      : (currentLang === "kg" ? "Кирүү" : "Войти");
  }

  const notificationsButton = $("#notificationsButton");
  if (notificationsButton) {
    notificationsButton.hidden = !currentUser;
  }

  const messagesButton = $("#messagesButton");
  if (messagesButton) {
    messagesButton.hidden = !currentUser;
  }

  const adminNav = $("#adminNavButton");
  if (adminNav) {
    adminNav.hidden = !(currentUser?.role === "admin");
    adminNav.textContent = currentLang === "kg" ? "🛡️ Админ-панел" : "🛡️ Админ-панель";
  }
}

/* ---- Вход через Google ---- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не удалось загрузить скрипт Google."));
    document.head.appendChild(script);
  });
}

async function initGoogle() {
  try {
    const config = await api("/api/auth/google");

    if (!config.googleEnabled || !config.googleClientId) return;

    const section = $("#googleSection");
    if (section) section.classList.remove("hidden");

    await loadScript("https://accounts.google.com/gsi/client");
    if (!window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async (response) => {
        try {
          const data = await api("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential: response.credential }),
          });
          finishLogin(data.user, "Вход через Google выполнен!");
        } catch (error) {
          setMessage("#authMessage", error.message, true);
        }
      },
    });

    window.google.accounts.id.renderButton($("#googleButton"), {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      locale: "ru",
    });
  } catch {
    // Кнопка Google не появится — вход по почте и телефону остаётся доступным.
  }
}

/* ---- Вход по номеру телефона ---- */

function resetPhoneForm() {
  phoneStage = "request";
  phoneNeedName = false;

  $("#phoneCodeLabel")?.classList.add("hidden");
  $("#phoneCodeInput")?.classList.add("hidden");
  $("#phoneNameLabel")?.classList.add("hidden");
  $("#phoneNameInput")?.classList.add("hidden");
  $("#phoneResetButton")?.classList.add("hidden");

  if ($("#phoneSubmit")) {
    $("#phoneSubmit").textContent = "Получить код";
  }
}

$("#phoneForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const phone = $("#phoneInput").value.trim();
  setMessage("#phoneMessage", "");

  if (!phone) {
    setMessage("#phoneMessage", "Введи номер телефона.", true);
    return;
  }

  if (phoneStage === "request") {
    try {
      const res = await api("/api/auth/phone/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });

      phoneStage = "verify";
      $("#phoneCodeLabel")?.classList.remove("hidden");
      $("#phoneCodeInput")?.classList.remove("hidden");
      if (res.directCode && $("#phoneCodeInput")) {
        $("#phoneCodeInput").value = res.directCode;
      }
      $("#phoneCodeInput")?.focus();
      $("#phoneResetButton")?.classList.remove("hidden");

      if ($("#phoneSubmit")) {
        $("#phoneSubmit").textContent = "Подтвердить вход";
      }

      if (res.directCode) {
        showToast("🔑 Код входа: " + res.directCode + " (подставлен)");
      }
      setMessage("#phoneMessage", `Код подтверждения: <b>${res.directCode}</b> (подставлен автоматически в форму).`);
    } catch (error) {
      setMessage("#phoneMessage", error.message, true);
    }
    return;
  }

  const code = $("#phoneCodeInput").value.trim();

  if (!/^\d{6}$/.test(code)) {
    setMessage("#phoneMessage", "Код состоит из 6 цифр.", true);
    return;
  }

  const payload = { phone, code };
  if (phoneNeedName) {
    payload.name = $("#phoneNameInput").value.trim();
  }

  try {
    const data = await api("/api/auth/phone/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    finishLogin(data.user, "Вход по номеру телефона выполнен!");
  } catch (error) {
    if (error.data?.needName) {
      phoneNeedName = true;
      $("#phoneNameLabel")?.classList.remove("hidden");
      $("#phoneNameInput")?.classList.remove("hidden");
      $("#phoneNameInput")?.focus();
      setMessage(
        "#phoneMessage",
        "Новый номер: укажи имя, чтобы создать аккаунт.",
        true,
      );
      return;
    }
    setMessage("#phoneMessage", error.message, true);
  }
});

$("#phoneResetButton")?.addEventListener("click", () => {
  resetPhoneForm();
  setMessage("#phoneMessage", "");
  $("#phoneInput")?.focus();
});

/* ---- Забыли пароль? ---- */

async function sendPasswordResetEmail(email, code, userName = "Пользователь") {
  const serviceId = localStorage.getItem("emailjs_service_id") || window.EMAILJS_SERVICE_ID || "";
  const templateId = localStorage.getItem("emailjs_template_id") || window.EMAILJS_TEMPLATE_ID || "";
  const publicKey = localStorage.getItem("emailjs_public_key") || window.EMAILJS_PUBLIC_KEY || "";

  if (window.emailjs && publicKey && serviceId && templateId) {
    try {
      emailjs.init({ publicKey });
      await emailjs.send(serviceId, templateId, {
        to_email: email,
        to_name: userName,
        reset_code: code,
        reset_link: `${window.location.origin}/?code=${code}`,
        app_name: "NurPoput"
      });
      console.info(`[EmailJS] Письмо с кодом успешно отправлено на ${email}`);
      return true;
    } catch (err) {
      console.warn("[EmailJS] Ошибка отправки письма:", err);
    }
  }
  return false;
}

$("#forgotForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("#forgotMessage", "");

  if (forgotStage === "request") {
    const email = $("#forgotEmail")?.value.trim() || "";
    const phone = $("#forgotPhone")?.value.trim() || "";

    if (!email) {
      setMessage("#forgotMessage", "Введи электронную почту.", true);
      return;
    }
    if (!phone) {
      setMessage("#forgotMessage", "Введи номер телефона аккаунта.", true);
      return;
    }

    try {
      const data = await api("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email, phone }),
      });

      forgotStage = "reset";
      $("#forgotCodeFields")?.classList.remove("hidden");

      if ($("#forgotSubmit")) {
        $("#forgotSubmit").textContent = "Сохранить новый пароль";
      }

      if (data.emailSent) {
        if ($("#forgotCode")) {
          $("#forgotCode").value = "";
          $("#forgotCode").focus();
        }
        showToast("✉️ Код отправлен на почту " + email + "!");
        setMessage(
          "#forgotMessage",
          `✉️ Код подтверждения отправлен на вашу электронную почту <b>${escapeHTML(email)}</b>.<br>` +
          `Пожалуйста, проверьте входящие сообщения (или папку «Спам»), скопируйте 6-значный код и введите его в поле ниже, чтобы задать новый пароль.`
        );
      } else {
        if ($("#forgotCode") && data.code) {
          $("#forgotCode").value = data.code;
        }
        if ($("#forgotPassword")) {
          $("#forgotPassword").focus();
        }
        showToast("🔑 Код сформирован!");
        setMessage(
          "#forgotMessage",
          `✉️ Запрос на сброс пароля для <b>${escapeHTML(email)}</b> принят.<br>` +
          `Проверочный код: <b style="font-size: 16px; color: #059669; letter-spacing: 1px;">${data.code}</b>.<br>` +
          `<small style="color: #64748b;">(В локальном/автономном режиме код сгенерирован сразу. Задайте новый пароль ниже).</small>`
        );
      }
    } catch (error) {
      setMessage("#forgotMessage", error.message, true);
    }
    return;
  }

  const code = $("#forgotCode").value.trim();
  const password = $("#forgotPassword").value;

  if (!/^\d{6}$/.test(code)) {
    setMessage("#forgotMessage", "Код состоит из 6 цифр.", true);
    return;
  }

  if (password.length < 6) {
    setMessage(
      "#forgotMessage",
      "Пароль должен содержать минимум 6 символов.",
      true,
    );
    return;
  }

  try {
    const data = await api("/api/auth/reset", {
      method: "POST",
      body: JSON.stringify({ code, password }),
    });
    finishLogin(data.user, data.message || "Пароль обновлён.");
  } catch (error) {
    setMessage("#forgotMessage", error.message, true);
  }
});

function resetForgotForm() {
  forgotStage = "request";

  $("#forgotCodeFields")?.classList.add("hidden");

  if ($("#forgotSubmit")) {
    $("#forgotSubmit").textContent = "Получить код";
  }
}

$("#forgotLink")?.addEventListener("click", () => {
  resetForgotForm();
  setMessage("#forgotMessage", "");
  showPage("forgot");
});

function prefillReset(code) {
  resetForgotForm();
  forgotStage = "reset";

  $("#forgotCodeFields")?.classList.remove("hidden");

  if ($("#forgotCode")) {
    $("#forgotCode").value = code;
  }

  if ($("#forgotSubmit")) {
    $("#forgotSubmit").textContent = "Задать новый пароль";
  }

  setMessage("#forgotMessage", "Вставь код из письма и задай новый пароль.");
  showPage("forgot");
}

/* =====================================
   УВЕДОМЛЕНИЯ И СЧЁТЧИКИ
   ===================================== */

function updateBadge(selector, count) {
  const badge = $(selector);
  if (!badge) return;

  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

async function refreshNotificationBadge() {
  if (!currentUser) {
    updateBadge("#notificationBadge", 0);
    return;
  }

  try {
    const data = await api("/api/notifications");
    updateBadge("#notificationBadge", data.unread);
  } catch {
    // тихо игнорируем — счётчик обновится позже
  }
}

async function refreshMessageBadge() {
  if (!currentUser) {
    updateBadge("#messageBadge", 0);
    return;
  }

  try {
    const data = await api("/api/messages");
    const total = data.threads.reduce(
      (sum, thread) => sum + (thread.unread || 0),
      0,
    );
    updateBadge("#messageBadge", total);
  } catch {
    // тихо игнорируем — счётчик обновится позже
  }
}

async function refreshBadges() {
  await Promise.all([refreshNotificationBadge(), refreshMessageBadge()]);
}

function renderNotifications(items) {
  const container = $("#profileNotifications");
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML =
      "<p class='form-message'>Уведомлений пока нет. Здесь появятся заявки на твои поездки.</p>";
    return;
  }

  container.innerHTML = items
    .map(
      (notification) => `
        <article class="ride-card notification-item ${
          notification.read ? "" : "notification-unread"
        }">
            <h3>${escapeHTML(notification.title)}</h3>
            <p>${escapeHTML(notification.message || notification.body || "")}</p>
            <small>${escapeHTML(
              new Date(notification.createdAt).toLocaleString("ru-RU"),
            )}</small>
        </article>
    `,
    )
    .join("");
}

$("#logoutButton")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // игнорируем ошибки выхода
  }

  currentUser = null;
  stopChatPolling();
  updateAccountButton();
  updateBadge("#notificationBadge", 0);
  updateBadge("#messageBadge", 0);
  setMessage("#profileMessage", "Ты вышла из аккаунта.");
  showPage("home");
  showToast("Ты вышла из аккаунта.");
});

/* =====================================
   ПОИСК ПОЕЗДОК И БРОНИРОВАНИЕ МЕСТ
   ===================================== */

function getCarClassBadge(carClass) {
  const c = String(carClass || "comfort").toLowerCase();
  switch (c) {
    case "economy":
      return `<span class="car-class-badge class-economy">🟢 Эконом</span>`;
    case "comfort":
      return `<span class="car-class-badge class-comfort">🔵 Комфорт</span>`;
    case "business":
      return `<span class="car-class-badge class-business">🟣 Бизнес</span>`;
    case "minivan":
      return `<span class="car-class-badge class-minivan">🟡 Минивэн</span>`;
    case "premium":
      return `<span class="car-class-badge class-premium">👑 Премиум</span>`;
    default:
      return `<span class="car-class-badge class-comfort">🔵 Авто</span>`;
  }
}

function renderRides(rides) {
  const container = $("#rideResults");
  if (!container) return;

  if (!rides || rides.length === 0) {
    container.innerHTML = `
      <div class="empty-state car-search-empty-state">
        <span style="font-size: 44px; display: block; margin-bottom: 10px;">🚙</span>
        <h3 style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">Подходящих машин не найдено</h3>
        <p style="color: #64748b; margin-bottom: 18px; max-width: 440px; margin-left: auto; margin-right: auto; line-height: 1.4;">
          Сейчас нет свободных водителей по этому направлению. Оставьте заявку — <b>мы автоматически пришлем вам уведомление</b>, как только водитель опубликует подходящую поездку!
        </p>
        <button type="button" class="primary-button btn-save-ride-request btn-open-request-modal" style="max-width: 340px; margin: 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
          🔔 Оставить заявку на поиск машины
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = rides
    .map((ride) => {
      const isVip = Boolean(ride.isVip);
      const isMyRide = currentUser && currentUser.id === ride.driverId;
      const seatsLeft = Number(ride.seats) || 0;
      const isFull = seatsLeft <= 0;

      return `
        <article class="ride-card ${isVip ? 'is-vip' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
            <div>
              <h3 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span>${escapeHTML(ride.fromCity)}</span>
                <span style="color: var(--green);">➔</span>
                <span>${escapeHTML(ride.toCity)}</span>
                ${isVip ? '<span class="vip-badge">🔥 VIP СРОЧНО</span>' : ''}
              </h3>
            </div>
            <div class="ride-price" style="font-size: 19px; font-weight: 800; color: var(--green); white-space: nowrap;">
              ${escapeHTML(ride.price)} сом
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">
            ${getCarClassBadge(ride.carClass)}
            ${ride.carPlate ? `<span class="car-plate-badge">${escapeHTML(ride.carPlate)}</span>` : ""}
            <span style="font-weight: 600; color: #1e293b;">🚗 ${escapeHTML(ride.carBrand || "")} ${escapeHTML(ride.carModel || ride.car || "Автомобиль")}</span>
            ${ride.carColor ? `<span class="car-color-tag">🎨 ${escapeHTML(ride.carColor)}</span>` : ""}
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; font-size: 14px; margin-bottom: 10px; color: #475569;">
            <div>📅 <b>Дата:</b> ${escapeHTML(ride.date)}</div>
            <div>🕒 <b>Время:</b> ${escapeHTML(ride.time || "Удобное")}</div>
            <div>
              <span class="seats-badge ${isFull ? 'full' : ''}">
                💺 ${isFull ? 'Все места заняты' : `Свободно: ${seatsLeft} мест`}
              </span>
            </div>
          </div>

          <div style="font-size: 14px; color: #334155; border-top: 1px solid #f1f5f9; padding-top: 8px; margin-bottom: 10px;">
            <strong>👤 Водитель:</strong> ${escapeHTML(ride.driverName)} · 📞 <a href="tel:${escapeHTML(ride.phone)}" style="color: var(--green); font-weight: 700; text-decoration: none;">${escapeHTML(ride.phone)}</a>
          </div>

          ${ride.comment ? `<p style="font-size: 13px; color: #64748b; margin-bottom: 12px; font-style: italic;">«${escapeHTML(ride.comment)}»</p>` : ""}

          ${isMyRide && !isVip ? `
            <div style="margin-bottom: 10px;">
              <button type="button" class="btn-boost-vip boost-ride-btn" data-ride-id="${ride.id}" style="width: 100%; justify-content: center;">
                🔥 Поднять поездку в VIP (50 сом)
              </button>
            </div>
          ` : ''}

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${!isFull ? `
              <button type="button" class="primary-button book-ride-button" data-ride-id="${escapeHTML(ride.id)}" style="flex: 2; min-height: 44px;">
                💺 Забронировать места
              </button>
            ` : `
              <button type="button" class="secondary-button" disabled style="flex: 2; min-height: 44px; opacity: 0.6; cursor: not-allowed;">
                🔒 Мест нет
              </button>
            `}
            <a href="tel:${escapeHTML(ride.phone)}" class="secondary-button" style="text-decoration: none; flex: 1; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
              📞 Позвонить
            </a>
          </div>
        </article>
      `;
    })
    .join("");
}

$("#searchRideForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const from = $("#searchFrom")?.value || "";
  const to = $("#searchTo")?.value || "";
  const date = $("#searchDate")?.value || "";
  const time = $("#searchTime")?.value || "";
  const passengers = Number($("#searchPassengers")?.value || 1);
  const carClass = $("#searchCarClass")?.value || "";

  if (from && to && from === to) {
    showToast("Город отправления и город назначения должны отличаться.");
    return;
  }

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (date) params.set("date", date);
  if (time) params.set("time", time);
  if (passengers > 1) params.set("passengers", String(passengers));
  if (carClass) params.set("carClass", carClass);

  try {
    const data = await api("/api/rides?" + params.toString());
    renderRides(data.rides || []);

    if (data.rides && data.rides.length > 0) {
      showToast("Найдено подходящих поездок: " + data.rides.length);
    }
  } catch (error) {
    showToast(error.message);
  }
});

$("#btnResetSearchRide")?.addEventListener("click", async () => {
  if ($("#searchFrom")) $("#searchFrom").value = "";
  if ($("#searchTo")) $("#searchTo").value = "";
  if ($("#searchDate")) $("#searchDate").value = "";
  if ($("#searchTime")) $("#searchTime").value = "";
  if ($("#searchPassengers")) $("#searchPassengers").value = "1";
  if ($("#searchCarClass")) $("#searchCarClass").value = "";

  try {
    const data = await api("/api/rides");
    renderRides(data.rides || []);
  } catch (e) {
    showToast(e.message);
  }
});

/* =====================================
   ПУБЛИКАЦИЯ ПОЕЗДКИ
   ===================================== */

$("#publishRideForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showToast("Сначала войди или зарегистрируйся.");
    showPage("auth");
    return;
  }

  const from = $("#publishFrom")?.value || "";
  const to = $("#publishTo")?.value || "";
  if (from === to) {
    showToast("Город отправления и назначения должны отличаться.");
    return;
  }

  const carBrand = $("#publishCarBrand")?.value || "Toyota";
  const carModel = $("#publishCarModel")?.value.trim() || "";
  const carClass = $("#publishCarClass")?.value || "comfort";
  const carColor = $("#publishCarColor")?.value || "Белый";
  const carPlate = $("#publishCarPlate")?.value.trim().toUpperCase() || "";
  const isVip = Boolean($("#publishIsVip")?.checked);

  const ride = {
    from,
    to,
    date: $("#publishDate")?.value || "",
    time: $("#publishTime")?.value || "",
    seats: Number($("#publishSeats")?.value || 4),
    price: Number($("#publishPrice")?.value || 0),
    car: [carBrand, carModel].filter(Boolean).join(" "),
    carBrand,
    carModel,
    carClass,
    carColor,
    carPlate,
    phone: $("#publishPhone")?.value.trim() || "",
    comment: $("#publishComment")?.value.trim() || "",
    isVip
  };

  try {
    await api("/api/rides", {
      method: "POST",
      body: JSON.stringify(ride),
    });

    $("#publishRideForm").reset();
    setMinimumDates();
    setMessage("#publishMessage", "Поездка успешно опубликована! Пассажиры видят её в поиске.");
    showToast(isVip ? "Поездка опубликована и поднята в ТОП (VIP)!" : "Поездка опубликована!");
    loadHomeContent();
    showPage("home");
  } catch (error) {
    if (!handleAuthError(error)) {
      setMessage("#publishMessage", error.message, true);
      showToast(error.message);
    }
  }
});

/* =====================================
   ЛОГИКА БРОНИРОВАНИЯ И ЗАЯВОК
   ===================================== */

function openBookingModal(rideId) {
  if (!currentUser) {
    showToast("Чтобы забронировать место, сначала войдите в аккаунт.");
    showPage("auth");
    return;
  }

  const rides = LocalDB.get("rides", []);
  const ride = rides.find(r => r.id === Number(rideId));
  if (!ride) {
    showToast("Поездка не найдена.");
    return;
  }

  const seatsLeft = Number(ride.seats) || 0;
  if (seatsLeft <= 0) {
    showToast("Все места в этой поездке уже заняты.");
    return;
  }

  const modal = $("#bookingModal");
  if (!modal) return;

  $("#bookingTargetRideId").value = ride.id;

  const summaryEl = $("#bookingRideSummary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="font-weight: 700; font-size: 16px; margin-bottom: 6px; color: #0f172a;">
        ${escapeHTML(ride.fromCity)} ➔ ${escapeHTML(ride.toCity)}
      </div>
      <div style="font-size: 13px; color: #475569; display: flex; flex-direction: column; gap: 4px;">
        <div>📅 <b>Дата и время:</b> ${escapeHTML(ride.date)} в ${escapeHTML(ride.time || "удобное")}</div>
        <div>🚗 <b>Авто:</b> ${escapeHTML(ride.carBrand || "")} ${escapeHTML(ride.carModel || ride.car || "")} ${ride.carPlate ? `<span class="car-plate-badge">${escapeHTML(ride.carPlate)}</span>` : ""}</div>
        <div>👤 <b>Водитель:</b> ${escapeHTML(ride.driverName)} (тел: ${escapeHTML(ride.phone)})</div>
        <div>💰 <b>Цена за 1 место:</b> ${escapeHTML(ride.price)} сом</div>
        <div>💺 <b>Доступно для бронирования:</b> ${seatsLeft} мест</div>
      </div>
    `;
  }

  const seatsSelect = $("#bookingSeatsCount");
  if (seatsSelect) {
    seatsSelect.innerHTML = "";
    const maxBookable = Math.min(seatsLeft, 8);
    for (let i = 1; i <= maxBookable; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${i} ${i === 1 ? 'место' : (i < 5 ? 'места' : 'мест')}`;
      seatsSelect.appendChild(opt);
    }
  }

  const updateModalTotal = () => {
    const count = Number(seatsSelect?.value || 1);
    const total = (Number(ride.price) || 0) * count;
    const totalEl = $("#bookingTotalSum");
    if (totalEl) totalEl.textContent = total;
  };

  if (seatsSelect) {
    seatsSelect.onchange = updateModalTotal;
  }
  updateModalTotal();

  setMessage("#bookingModalMessage", "");
  modal.style.display = "flex";
}

function closeBookingModal() {
  const modal = $("#bookingModal");
  if (modal) modal.style.display = "none";
}

$("#btnCloseBookingModal")?.addEventListener("click", closeBookingModal);
$("#bookingModal")?.addEventListener("click", (e) => {
  if (e.target === $("#bookingModal")) closeBookingModal();
});

$("#bookingSeatsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rideId = Number($("#bookingTargetRideId")?.value);
  const seats = Number($("#bookingSeatsCount")?.value || 1);

  if (!rideId) return;

  const btn = $("#btnConfirmBooking");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Бронируем...";
  }

  try {
    const data = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ rideId, seats })
    });

    closeBookingModal();
    showToast(data.message || "Места успешно забронированы!");
    alert(data.message || "Бронирование подтверждено! Счастливого пути!");
    loadHomeContent();

    const searchForm = $("#searchRideForm");
    if (searchForm) {
      searchForm.dispatchEvent(new Event("submit"));
    }
  } catch (error) {
    setMessage("#bookingModalMessage", error.message, true);
    showToast(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✅ Подтвердить бронирование";
    }
  }
});

function openRideRequestModal(prefills = {}) {
  const modal = $("#rideRequestModal");
  if (!modal) return;

  if (prefills.from && $("#reqFromCity")) $("#reqFromCity").value = prefills.from;
  if (prefills.to && $("#reqToCity")) $("#reqToCity").value = prefills.to;
  if (prefills.date && $("#reqDate")) $("#reqDate").value = prefills.date;
  if (prefills.time && $("#reqTime")) $("#reqTime").value = prefills.time;
  if (prefills.carClass && $("#reqCarClass")) $("#reqCarClass").value = prefills.carClass;
  if (prefills.seats && $("#reqSeats")) $("#reqSeats").value = String(prefills.seats);

  if ($("#reqPassengerPhone")) {
    $("#reqPassengerPhone").value = currentUser?.phone || "";
  }

  setMessage("#rideRequestModalMessage", "");
  modal.style.display = "flex";
}

function closeRideRequestModal() {
  const modal = $("#rideRequestModal");
  if (modal) modal.style.display = "none";
}

$("#btnCloseRideRequestModal")?.addEventListener("click", closeRideRequestModal);
$("#rideRequestModal")?.addEventListener("click", (e) => {
  if (e.target === $("#rideRequestModal")) closeRideRequestModal();
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-open-request-modal") || e.target.closest("#btnOpenRideRequestModal");
  if (btn) {
    const from = $("#searchFrom")?.value || $("#homeSearchFrom")?.value || "";
    const to = $("#searchTo")?.value || $("#homeSearchTo")?.value || "";
    const date = $("#searchDate")?.value || $("#homeSearchDate")?.value || "";
    const time = $("#searchTime")?.value || $("#homeSearchTime")?.value || "";
    const carClass = $("#searchCarClass")?.value || $("#homeSearchCarClass")?.value || "";
    const seats = $("#searchPassengers")?.value || $("#homeSearchPassengers")?.value || "1";
    openRideRequestModal({ from, to, date, time, carClass, seats });
  }
});

$("#saveRideRequestForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const from = $("#reqFromCity")?.value;
  const to = $("#reqToCity")?.value;
  const date = $("#reqDate")?.value;
  const time = $("#reqTime")?.value;
  const passengers = Number($("#reqSeats")?.value || 1);
  const carClass = $("#reqCarClass")?.value || "";
  const phone = $("#reqPassengerPhone")?.value.trim();

  if (from === to) {
    setMessage("#rideRequestModalMessage", "Город отправления и назначения должны отличаться.", true);
    return;
  }

  const btn = $("#btnSubmitRideRequest");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Сохраняем...";
  }

  try {
    const data = await api("/api/ride-requests", {
      method: "POST",
      body: JSON.stringify({
        from,
        to,
        date,
        time,
        passengers,
        carClass,
        phone
      })
    });

    closeRideRequestModal();
    showToast(data.message || "Заявка на поиск машины сохранена!");
    alert("Заявка сохранена! Как только появится подходящая машина, мы уведомим вас.");
  } catch (error) {
    setMessage("#rideRequestModalMessage", error.message, true);
    showToast(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔔 Сохранить заявку (бесплатно)";
    }
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest(".book-ride-button");
  if (!button) return;
  event.preventDefault();

  const rideId = button.dataset.rideId;
  if (rideId) {
    openBookingModal(rideId);
  }
});

/* =====================================
   ПОСЫЛКИ
   ===================================== */

document.querySelectorAll("[data-parcel-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-parcel-tab]").forEach((item) => {
      item.classList.toggle("active", item === tab);
    });

    const isSearch = tab.dataset.parcelTab === "search";

    $("#parcelSearchBlock")?.classList.toggle("hidden", !isSearch);
    $("#parcelPublishBlock")?.classList.toggle("hidden", isSearch);
  });
});

function renderParcelCards(parcels) {
  const container = $("#parcelResults");
  if (!container) return;

  if (parcels.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <span>📦</span>
                <h3>Посылок не найдено</h3>
                <p>Измени фильтры или загляни позже.</p>
            </div>
        `;
    return;
  }

  container.innerHTML = parcels
    .map(
      (parcel) => `
        <article class="ride-card">
            <h3>📦 ${escapeHTML(parcel.fromCity)} → ${escapeHTML(parcel.toCity)}</h3>
            <p>📅 Дата: ${escapeHTML(parcel.date)}</p>
            <p>📏 Размер: ${escapeHTML(parcel.size || "не указан")}</p>
            <p>📝 ${escapeHTML(parcel.description)}</p>
            <p>Отправитель: ${escapeHTML(parcel.senderName)} · 📞 <a href="tel:${escapeHTML(parcel.senderPhone)}">${escapeHTML(parcel.senderPhone)}</a></p>
            <p>Получатель: ${escapeHTML(parcel.recipientName)} · 📞 <a href="tel:${escapeHTML(parcel.recipientPhone)}">${escapeHTML(parcel.recipientPhone)}</a></p>
            ${parcel.ownerName ? `<p>Заявку добавил(а): ${escapeHTML(parcel.ownerName)}</p>` : ""}
            <div style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap;">
              <button type="button" class="primary-button take-parcel-btn" data-parcel-id="${parcel.id}">
                📦 Взять заказ
              </button>
              <a href="tel:${escapeHTML(parcel.senderPhone)}" class="secondary-button" style="text-decoration: none; display: inline-flex; align-items: center;">
                📞 Позвонить
              </a>
            </div>
        </article>
    `,
    )
    .join("");
}

document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".take-parcel-btn");
  if (!btn) return;

  const parcelId = Number(btn.dataset.parcelId);
  if (!currentUser) {
    showToast("Сначала войди в аккаунт, чтобы взять заказ.");
    setAuthMode("login");
    showPage("auth");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Принимаем...";

  try {
    const data = await api("/api/parcels/take", {
      method: "POST",
      body: JSON.stringify({ parcelId }),
    });

    showToast(data.message || "Заказ успешно взят!");
    alert(data.message || "Вы успешно взяли заказ на доставку посылки!");
    loadParcelResults("");
  } catch (error) {
    showToast(error.message, true);
    btn.disabled = false;
    btn.textContent = "📦 Взять заказ";
  }
});

async function loadParcelResults(query) {
  const container = $("#parcelResults");
  if (!container) return;

  container.innerHTML = `
        <div class="empty-state">
            <span>📦</span>
            <h3>Загрузка…</h3>
        </div>
    `;

  try {
    const data = await api("/api/parcels/search" + query);
    renderParcelCards(data.parcels);
  } catch (error) {
    container.innerHTML = `
            <div class="empty-state">
                <span>📦</span>
                <h3>Не удалось загрузить посылки</h3>
                <p>${escapeHTML(error.message)}</p>
            </div>
        `;
  }
}

$("#parcelSearchForm")?.addEventListener("submit", (event) => {
  event.preventDefault();

  const params = new URLSearchParams();
  const from = $("#parcelSearchFrom").value;
  const to = $("#parcelSearchTo").value;
  const date = $("#parcelSearchDate").value;

  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (date) params.set("date", date);

  const query = params.toString();
  loadParcelResults(query ? "?" + query : "");
});

$("#parcelForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showToast("Сначала войди или зарегистрируйся.");
    showPage("auth");
    return;
  }

  const parcel = {
    from: $("#parcelFrom").value,
    to: $("#parcelTo").value,
    senderName: $("#senderName").value.trim(),
    senderPhone: $("#senderPhone").value.trim(),
    recipientName: $("#recipientName").value.trim(),
    recipientPhone: $("#recipientPhone").value.trim(),
    date: $("#parcelDate").value,
    size: $("#parcelSize").value,
    description: $("#parcelDescription").value.trim(),
  };

  try {
    await api("/api/parcels", {
      method: "POST",
      body: JSON.stringify(parcel),
    });

    $("#parcelForm").reset();
    setMinimumDates();
    setMessage("#parcelMessage", "Заявка сохранена. Она видна всем в поиске посылок.");
    showToast("Заявка на посылку создана!");
    loadHomeContent();
    showPage("home");
  } catch (error) {
    if (!handleAuthError(error)) {
      setMessage("#parcelMessage", error.message, true);
    }
  }
});

/* =====================================
   СООБЩЕНИЯ
   ===================================== */

async function showThreadList() {
  stopChatPolling();
  currentChatBookingId = null;

  $("#chatView")?.classList.add("hidden");
  $("#threadList")?.classList.remove("hidden");

  const container = $("#threadList");
  if (!container) return;

  container.innerHTML = `
        <div class="empty-state">
            <span>💬</span>
            <h3>Загрузка…</h3>
        </div>
    `;

  try {
    const data = await api("/api/messages");
    renderThreads(data.threads);
    refreshBadges();
  } catch (error) {
    handleAuthError(error);
    container.innerHTML = `
            <div class="empty-state">
                <span>💬</span>
                <h3>Не удалось загрузить чаты</h3>
                <p>${escapeHTML(error.message)}</p>
            </div>
        `;
  }
}

function renderThreads(threads) {
  const container = $("#threadList");
  if (!container) return;

  if (threads.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <span>💬</span>
                <h3>Пока нет переписок</h3>
                <p>Чат появляется после бронирования поездки — из карточки бронирования в личном кабинете.</p>
            </div>
        `;
    return;
  }

  container.innerHTML = threads
    .map((thread) => {
      const roleText = thread.role === "driver" ? "Пассажир" : "Водитель";
      const preview = thread.lastMessage
        ? (thread.lastMessage.mine ? "Вы: " : "") +
          escapeHTML(thread.lastMessage.body)
        : "Сообщений пока нет — напиши первым.";

      return `
            <article class="ride-card thread-card" data-thread-id="${thread.bookingId}">
                <div class="thread-meta">
                    <h3>${escapeHTML(thread.fromCity)} → ${escapeHTML(thread.toCity)}</h3>
                    ${thread.unread ? `<span class="unread-count">${thread.unread}</span>` : ""}
                </div>
                <p>${roleText}: ${escapeHTML(thread.otherName)}</p>
                <p>📅 ${escapeHTML(thread.date)} в ${escapeHTML(thread.time)} · 💺 ${escapeHTML(thread.seats)} · 💰 ${escapeHTML(thread.price)} сом</p>
                <p class="thread-preview">${preview}</p>
            </article>
        `;
    })
    .join("");
}

$("#threadList")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-thread-id]");
  if (card) {
    openChat(Number(card.dataset.threadId));
  }
});

function renderChatMessage(message) {
  return `
        <div class="chat-message ${message.mine ? "mine" : ""}">
            ${escapeHTML(message.body)}
            <time>${escapeHTML(
              new Date(message.createdAt).toLocaleString("ru-RU"),
            )}</time>
        </div>
    `;
}

async function openChat(bookingId) {
  stopChatPolling();
  currentChatBookingId = bookingId;

  $("#threadList")?.classList.add("hidden");
  $("#chatView")?.classList.remove("hidden");

  const box = $("#chatMessages");
  if (box) {
    box.innerHTML = "<p class='chat-empty'>Загрузка…</p>";
  }

  try {
    const data = await api("/api/messages?bookingId=" + bookingId);
    renderChat(data);

    chatTimer = setInterval(() => refreshChat(), 8000);
    refreshBadges();
  } catch (error) {
    handleAuthError(error);
    if (box) {
      box.innerHTML = `<p class='chat-empty'>${escapeHTML(error.message)}</p>`;
    }
  }
}

function renderChat(data) {
  const title = $("#chatTitle");
  const subtitle = $("#chatSubtitle");

  if (title) {
    title.textContent = `${data.thread.fromCity} → ${data.thread.toCity} · ${data.thread.date}`;
  }

  if (subtitle) {
    const roleText =
      data.thread.role === "driver" ? "Пассажир" : "Водитель";
    const contact = data.thread.otherPhone
      ? ` · 📞 ${data.thread.otherPhone}`
      : "";
    subtitle.textContent = `${roleText}: ${data.thread.otherName}${contact}`;
  }

  const box = $("#chatMessages");
  if (!box) return;

  box.innerHTML =
    data.messages.length === 0
      ? "<p class='chat-empty'>Напиши первое сообщение — его увидит только участник поездки.</p>"
      : data.messages.map(renderChatMessage).join("");

  box.scrollTop = box.scrollHeight;
}

async function refreshChat() {
  if (!currentChatBookingId || !currentUser) {
    stopChatPolling();
    return;
  }

  try {
    const data = await api("/api/messages?bookingId=" + currentChatBookingId);
    const box = $("#chatMessages");
    if (!box) return;

    const wasAtBottom =
      box.scrollHeight - box.scrollTop - box.clientHeight < 80;

    box.innerHTML = data.messages.map(renderChatMessage).join("");

    if (wasAtBottom) {
      box.scrollTop = box.scrollHeight;
    }

    refreshBadges();
  } catch {
    // повторим попытку на следующем тике
  }
}

$("#chatForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const input = $("#chatInput");
  const text = input ? input.value.trim() : "";

  if (!text || !currentChatBookingId) return;

  try {
    const data = await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({ bookingId: currentChatBookingId, body: text }),
    });

    if (input) input.value = "";

    const box = $("#chatMessages");
    if (box) {
      box.querySelector(".chat-empty")?.remove();
      box.insertAdjacentHTML(
        "beforeend",
        renderChatMessage({ ...data.message, read: true }),
      );
      box.scrollTop = box.scrollHeight;
    }

    refreshBadges();
  } catch (error) {
    if (!handleAuthError(error)) {
      showToast(error.message);
    }
  }
});

$("#chatBackButton")?.addEventListener("click", () => {
  showThreadList();
});

/* =====================================
   АВАТАР ПРОФИЛЯ
   ===================================== */

function avatarUrlFor(user) {
  if (!user || !(user.avatarVersion > 0)) return null;
  return `/api/avatar?userId=${user.id}&v=${user.avatarVersion}`;
}

function renderAvatar() {
  const img = $("#avatarImage");
  const placeholder = $("#avatarSvgPlaceholder");
  if (!img) return;

  const storedBackup = currentUser ? (localStorage.getItem("user_avatar_" + currentUser.id) || localStorage.getItem("nurpoput_saved_avatar")) : localStorage.getItem("nurpoput_saved_avatar");
  const avatarSrc = currentUser?.avatar || storedBackup || (currentUser?.avatarVersion ? avatarUrlFor(currentUser) : null);

  if (avatarSrc) {
    if (currentUser && !currentUser.avatar) currentUser.avatar = avatarSrc;
    img.src = avatarSrc;
    img.style.display = "block";
    if (placeholder) placeholder.style.display = "none";
    if ($("#avatarUploadButton")) {
      $("#avatarUploadButton").textContent = "📷 " + (currentLang === "kg" ? "Сүрөттү алмаштыруу" : "Сменить фото");
    }
  } else {
    img.style.display = "none";
    img.removeAttribute("src");
    if (placeholder) placeholder.style.display = "block";
    if ($("#avatarUploadButton")) {
      $("#avatarUploadButton").textContent = "📷 " + (currentLang === "kg" ? "Сүрөт жүктөө" : "Загрузить фото");
    }
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.onload = () => {
      const image = new Image();

      image.onerror = () => reject(new Error("Не удалось открыть изображение."));
      image.onload = () => {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const target = Math.min(512, side);
        const sx = (image.naturalWidth - side) / 2;
        const sy = (image.naturalHeight - side) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = target;
        canvas.height = target;

        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Не удалось обработать изображение."));
          return;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, target, target);
        context.drawImage(
          image,
          sx,
          sy,
          side,
          side,
          0,
          0,
          target,
          target,
        );

        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };

      image.src = String(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

$("#avatarUploadButton")?.addEventListener("click", () => {
  $("#avatarInput")?.click();
});
$("#singleAvatarBox")?.addEventListener("click", () => {
  $("#avatarInput")?.click();
});

$("#avatarInput")?.addEventListener("change", async () => {
  const input = $("#avatarInput");
  const file = input?.files?.[0];
  if (input) input.value = "";
  if (!file) return;

  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
    showToast("Выбери изображение PNG, JPEG или WebP.");
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    showToast("Файл слишком большой — до 8 МБ.");
    return;
  }

  setMessage("#avatarMessage", currentLang === "kg" ? "Сүрөт иштетилүүдө…" : "Обрабатываю фото…");

  try {
    const dataUrl = await resizeImage(file);
    try {
      await api("/api/avatar", {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
    } catch {}

    if (currentUser) {
      currentUser.avatar = dataUrl;
      try {
        localStorage.setItem("user_avatar_" + currentUser.id, dataUrl);
        localStorage.setItem("nurpoput_saved_avatar", dataUrl);
      } catch (e) {}
      const users = LocalDB.get("users_v3", []);
      const user = users.find(u => u.id === currentUser.id);
      if (user) {
        user.avatar = dataUrl;
        LocalDB.set("users_v3", users);
      }
      LocalDB.set("session_user", currentUser);
    }
    renderAvatar();
    setMessage("#avatarMessage", currentLang === "kg" ? "Сүрөт сакталды." : "Фото профиля обновлено.");
    showToast(currentLang === "kg" ? "Сүрөт сакталды!" : "Фото профиля сохранено!");
  } catch (error) {
    if (!handleAuthError(error)) {
      setMessage("#avatarMessage", error.message, true);
    }
  }
});

/* =====================================
   ПРОФИЛЬ
   ===================================== */

async function loadProfile() {
  if (!currentUser) return;

  renderAvatar();

  if ($("#profileDisplayName")) $("#profileDisplayName").textContent = currentUser.name;
  if ($("#profileName")) $("#profileName").textContent = currentUser.name;
  if ($("#profileEmail")) $("#profileEmail").textContent = currentUser.email || "—";
  if ($("#profilePhone")) $("#profilePhone").textContent = currentUser.phone || "—";
  if ($("#profileWelcome")) {
    $("#profileWelcome").textContent = (currentLang === "kg" ? "Кош келдиңиз, " : "Добро пожаловать, ") + currentUser.name + "!";
  }

  const roleBadge = $("#profileRoleBadge");
  const adminBanner = $("#profileAdminBanner");
  const adminNav = $("#adminNavButton");
  if (currentUser?.role === "admin") {
    if (roleBadge) {
      roleBadge.textContent = "🛡️ " + (currentLang === "kg" ? "Администратор" : "Администратор");
      roleBadge.className = "profile-role-pill admin";
    }
    if (adminBanner) adminBanner.style.display = "flex";
    if (adminNav) adminNav.hidden = false;
  } else {
    if (roleBadge) {
      roleBadge.textContent = currentLang === "kg" ? "Жүргүнчү / Айдоочу" : "Пассажир / Водитель";
      roleBadge.className = "profile-role-pill";
    }
    if (adminBanner) adminBanner.style.display = "none";
    if (adminNav) adminNav.hidden = true;
  }

  try {
    const data = await api("/api/profile");
    currentUser = { ...currentUser, ...data.user };
    renderAvatar();

    if ($("#profileBalanceValue")) {
      $("#profileBalanceValue").textContent = currentUser.balance || 0;
    }

    const pendingBox = $("#profilePendingTopups");
    if (pendingBox) {
      if (data.pendingTopups && data.pendingTopups.length > 0) {
        pendingBox.innerHTML = data.pendingTopups.map(p => `
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 10px; color: #92400e; margin-top: 6px;">
            ⏳ <b>Заявка на ${p.amount} сом</b> отправлена на проверку. Администратор зачислит деньги после сверки в MBank.
          </div>
        `).join("");
      } else {
        pendingBox.innerHTML = "";
      }
    }

    const ridesList = $("#profileRides");
    const archiveList = $("#profileRidesArchive");
    if (ridesList) {
      const allRides = data.rides || [];
      const activeRides = allRides.filter(r => (r.status === "published" || !r.status) && Number(r.seats) > 0);
      const archivedRides = allRides.filter(r => r.status === "archived" || r.status === "full" || Number(r.seats) <= 0);

      if ($("#driverActiveCount")) $("#driverActiveCount").textContent = activeRides.length;
      if ($("#driverArchiveCount")) $("#driverArchiveCount").textContent = archivedRides.length;

      if (activeRides.length === 0) {
        ridesList.innerHTML = "<p class='form-message'>У вас сейчас нет активных поездок.</p>";
      } else {
        ridesList.innerHTML = activeRides.map(ride => {
          const isVip = Boolean(ride.isVip);
          return `
            <article class="ride-card ${isVip ? 'is-vip' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <h3 style="margin: 0;">${escapeHTML(ride.fromCity)} ➔ ${escapeHTML(ride.toCity)}</h3>
                ${isVip ? '<span class="vip-badge">🔥 VIP СРОЧНО</span>' : ''}
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; margin-bottom: 6px;">
                ${getCarClassBadge(ride.carClass)}
                ${ride.carPlate ? `<span class="car-plate-badge">${escapeHTML(ride.carPlate)}</span>` : ""}
                <span style="font-size: 13px; font-weight: 600;">🚗 ${escapeHTML(ride.carBrand || "")} ${escapeHTML(ride.carModel || ride.car || "")}</span>
                ${ride.carColor ? `<span class="car-color-tag">🎨 ${escapeHTML(ride.carColor)}</span>` : ""}
              </div>
              <p>📅 ${escapeHTML(ride.date)} в ${escapeHTML(ride.time)}</p>
              <p>💺 Свободных мест: ${escapeHTML(ride.seats)}</p>
              <p class="ride-price">${escapeHTML(ride.price)} сом за место</p>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
                ${!isVip ? `
                  <button type="button" class="btn-boost-vip boost-ride-btn" data-ride-id="${ride.id}">
                    🔥 Поднять в VIP (50 сом)
                  </button>
                ` : `
                  <span style="color: #059669; font-size: 13px; font-weight: 700;">✓ В топе поиска (VIP)</span>
                `}
                <button type="button" class="secondary-button btn-archive-my-ride" data-ride-id="${ride.id}" style="color: #065f46; border-color: #a7f3d0; background: #ecfdf5;">
                  ✅ Клиенты найдены (в архив)
                </button>
                <button type="button" class="secondary-button btn-delete-my-ride" data-ride-id="${ride.id}" style="color: #dc2626; border-color: #fca5a5;">
                  🗑️ Удалить поездку
                </button>
              </div>
            </article>
          `;
        }).join("");
      }

      if (archiveList) {
        if (archivedRides.length === 0) {
          archiveList.innerHTML = "<p class='form-message'>В архиве пока нет поездок.</p>";
        } else {
          archiveList.innerHTML = archivedRides.map(ride => `
            <article class="ride-card" style="opacity: 0.95; background: #f8fafc; border-color: #cbd5e1;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <h3 style="margin: 0; color: #475569;">${escapeHTML(ride.fromCity)} ➔ ${escapeHTML(ride.toCity)}</h3>
                <span class="profile-role-pill" style="font-size: 11px; background: #e2e8f0; color: #475569;">📁 Архив / Завершена</span>
              </div>
              <p style="font-size: 13px; color: #64748b; margin-top: 4px;">📅 ${escapeHTML(ride.date)} в ${escapeHTML(ride.time)} · 💰 ${escapeHTML(ride.price)} сом · 🚗 ${escapeHTML(ride.car || "Авто")}</p>
              <div style="margin-top: 10px;">
                <button type="button" class="secondary-button btn-delete-my-ride" data-ride-id="${ride.id}" style="color: #dc2626; border-color: #fca5a5; font-size: 12px; padding: 4px 10px;">
                  🗑️ Удалить из архива навсегда
                </button>
              </div>
            </article>
          `).join("");
        }
      }
    }

    const driverList = $("#profileDriverBookings");
    if (driverList) {
      if (data.driverBookings.length === 0) {
        driverList.innerHTML =
          "<p class='form-message'>Заявок на твои поездки пока нет.</p>";
      } else {
        driverList.innerHTML = data.driverBookings
          .map(
            ({ booking, ride, passengerName }) => `
              <article class="ride-card">
                  <h3>${escapeHTML(ride.fromCity)} → ${escapeHTML(ride.toCity)}</h3>
                  <p>📅 ${escapeHTML(ride.date)} в ${escapeHTML(ride.time)}</p>
                  <p>👤 Пассажир: ${escapeHTML(passengerName)} · 💺 ${escapeHTML(booking.seats)}</p>
                  <p>💰 ${escapeHTML(ride.price * booking.seats)} сом · Статус: ${escapeHTML(booking.status)}</p>
                  <button class="secondary-button small chat-open-button" data-chat-booking="${booking.id}">
                      💬 Открыть чат
                  </button>
              </article>
          `,
          )
          .join("");
      }
    }

    const bookingsList = $("#profileBookings");
    if (bookingsList) {
      if (data.bookings.length === 0) {
        bookingsList.innerHTML =
          "<p class='form-message'>У тебя пока нет бронирований.</p>";
      } else {
        bookingsList.innerHTML = data.bookings
          .map(
            ({ booking, ride }) => `
              <article class="ride-card">
                  <h3>${escapeHTML(ride.fromCity)} → ${escapeHTML(ride.toCity)}</h3>
                  <p>📅 ${escapeHTML(ride.date)} в ${escapeHTML(ride.time)}</p>
                  <p>💺 Мест: ${escapeHTML(booking.seats)}</p>
                  <p>💰 К оплате: ${escapeHTML(ride.price * booking.seats)} сом</p>
                  <p>📞 Водитель: ${escapeHTML(ride.phone)}</p>
                  <p>Статус: ${escapeHTML(booking.status)}</p>
                  <button class="secondary-button small chat-open-button" data-chat-booking="${booking.id}">
                      💬 Открыть чат
                  </button>
              </article>
          `,
          )
          .join("");
      }
    }

    const parcelsList = $("#profileParcels");
    if (parcelsList) {
      if (data.parcels.length === 0) {
        parcelsList.innerHTML =
          "<p class='form-message'>Ты ещё не оформлял(а) заявки на посылки.</p>";
      } else {
        parcelsList.innerHTML = data.parcels
          .map(
            (parcel) => {
              const isVip = Boolean(parcel.isVip);
              return `
                <article class="ride-card ${isVip ? 'is-vip' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                      <h3>📦 ${escapeHTML(parcel.fromCity)} → ${escapeHTML(parcel.toCity)}</h3>
                      ${isVip ? '<span class="vip-badge">🔥 VIP СРОЧНО</span>' : ''}
                    </div>
                    <p>📅 ${escapeHTML(parcel.date)} · 📏 ${escapeHTML(parcel.size)}</p>
                    <p>📝 ${escapeHTML(parcel.description)}</p>
                    <p>Статус: ${isVip ? '<b style="color: #d97706;">🔥 В топе списка (VIP)</b>' : escapeHTML(parcel.status)}</p>
                    <div style="margin-top: 10px;">
                      ${!isVip ? `
                        <button type="button" class="btn-boost-vip boost-parcel-btn" data-parcel-id="${parcel.id}">
                          🔥 Поднять в VIP (50 сом)
                        </button>
                      ` : `
                        <span style="color: #059669; font-size: 13px; font-weight: 700;">✓ Заявка на 1 месте в поиске</span>
                      `}
                    </div>
                </article>
              `;
            }
          )
          .join("");
      }
    }

    try {
      const notificationsData = await api("/api/notifications");
      renderNotifications(notificationsData.notifications);
      updateBadge("#notificationBadge", notificationsData.unread);

      if (notificationsData.unread > 0) {
        await api("/api/notifications/read", { method: "POST" });
        updateBadge("#notificationBadge", 0);
      }
    } catch {
      // уведомления не блокируют остальной профиль
    }
  } catch (error) {
    if (!handleAuthError(error)) {
      showToast(error.message);
    }
  }
}

// Изменение данных профиля (почта, телефон, пароль)
$("#btnToggleEditProfile")?.addEventListener("click", () => {
  const form = $("#profileEditForm");
  if (!form) return;
  const isHidden = form.style.display === "none";
  form.style.display = isHidden ? "block" : "none";
  if (isHidden && currentUser) {
    if ($("#editProfileName")) $("#editProfileName").value = currentUser.name || "";
    if ($("#editProfileEmail")) $("#editProfileEmail").value = currentUser.email || "";
    if ($("#editProfilePhone")) $("#editProfilePhone").value = currentUser.phone || "";
    if ($("#editProfilePassword")) $("#editProfilePassword").value = "";
    setMessage("#editProfileMessage", "");
  }
});

$("#btnCancelEditProfile")?.addEventListener("click", () => {
  if ($("#profileEditForm")) $("#profileEditForm").style.display = "none";
});

$("#profileEditForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  const name = $("#editProfileName")?.value.trim();
  const email = $("#editProfileEmail")?.value.trim();
  const phone = $("#editProfilePhone")?.value.trim();
  const password = $("#editProfilePassword")?.value || "";

  setMessage("#editProfileMessage", "");

  const payload = { name, email, phone };
  if (password) {
    payload.password = password;
  }

  try {
    const data = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    currentUser = { ...currentUser, ...data.user };

    if ($("#profileDisplayName")) $("#profileDisplayName").textContent = currentUser.name;
    if ($("#profileName")) $("#profileName").textContent = currentUser.name;
    if ($("#profileEmail")) $("#profileEmail").textContent = currentUser.email;
    if ($("#profilePhone")) $("#profilePhone").textContent = currentUser.phone;

    showToast("Данные профиля успешно обновлены!");
    alert("Данные профиля успешно обновлены!");
    if ($("#profileEditForm")) $("#profileEditForm").style.display = "none";
  } catch (error) {
    if (!handleAuthError(error)) {
      setMessage("#editProfileMessage", error.message, true);
    }
  }
});

$("#logoutButton")?.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  updateAccountButton();
  showToast("Вы вышли из аккаунта.");
  showPage("home");
});

$("#deleteMyAccountButton")?.addEventListener("click", async () => {
  if (!confirm("Вы действительно хотите навсегда удалить свой аккаунт? Все ваши поездки, заказы и баланс будут удалены.")) return;
  try {
    const res = await api("/api/auth/delete-account", { method: "POST" });
    currentUser = null;
    updateAccountButton();
    showToast(res.message || "Аккаунт успешно удалён.");
    showPage("home");
  } catch (err) {
    showToast(err.message, true);
  }
});

/* =====================================
   АДМИНИСТРАТОР
   ===================================== */

async function loadAdmin() {
  try {
    const data = await api("/api/admin");

    if ($("#adminUsers")) $("#adminUsers").textContent = "Зарегистрировано: " + (data.stats.users || 0);
    if ($("#adminRides")) $("#adminRides").textContent = "Всего поездок: " + (data.stats.rides || 0);
    if ($("#adminParcels")) $("#adminParcels").textContent = "Всего посылок: " + (data.stats.parcels || 0);
    if ($("#adminPayments")) $("#adminPayments").textContent = `Заявок: ${data.stats.pendingTopupsCount || 0} · VIP: ${data.stats.vipIncome || 0} сом`;

    // 1. Список пользователей и их балансов
    const usersList = $("#adminUsersList");
    if (usersList && data.users) {
      if (data.users.length === 0) {
        usersList.innerHTML = "<p style='color: #6b7280; font-size: 14px;'>Пользователей пока нет.</p>";
      } else {
        usersList.innerHTML = data.users
          .map((u) => {
            const isMe = currentUser && currentUser.id === u.id;
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; margin-bottom: 8px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; flex-wrap: wrap; gap: 10px;">
                <div>
                  <strong>👤 ${escapeHTML(u.name)}</strong> <span class="profile-role-pill ${u.role === 'admin' ? 'admin' : ''}" style="font-size: 11px; padding: 2px 8px;">${escapeHTML(u.role === 'admin' ? 'Администратор' : 'Пользователь')}</span><br>
                  <small style="color: #6b7280; font-size: 13px;">✉️ Почта: <b>${escapeHTML(u.email || "нет")}</b> | 📞 Телефон: <b>${escapeHTML(u.phone || "нет")}</b></small><br>
                  <small style="color: #15803d; font-size: 13px; font-weight: 700;">💳 Баланс: <b>${u.balance || 0} сом</b></small>
                </div>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                  <button type="button" class="secondary-button small admin-add-balance-btn" data-user-id="${u.id}" data-amount="50" style="padding: 5px 9px; font-size: 12px;">+50 сом</button>
                  <button type="button" class="secondary-button small admin-add-balance-btn" data-user-id="${u.id}" data-amount="100" style="padding: 5px 9px; font-size: 12px;">+100 сом</button>
                  ${
                    isMe
                      ? `<button type="button" class="secondary-button delete-user-btn" data-user-id="${u.id}" style="color: #dc2626; border-color: #fca5a5; padding: 6px 12px; font-size: 13px; margin-left: 6px;">🗑️ Удалить мой аккаунт</button>`
                      : `<button type="button" class="secondary-button delete-user-btn" data-user-id="${u.id}" style="color: #dc2626; border-color: #fca5a5; padding: 6px 12px; font-size: 13px; margin-left: 6px;">Удалить профиль</button>`
                  }
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    // 2. Список поездок
    const ridesList = $("#adminRidesList");
    if (ridesList) {
      const rides = data.rides || [];
      if (rides.length === 0) {
        ridesList.innerHTML = "<p style='color: #6b7280; font-size: 14px;'>Опубликованных поездок в системе пока нет.</p>";
      } else {
        ridesList.innerHTML = rides
          .map((r) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; margin-bottom: 8px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; flex-wrap: wrap; gap: 10px;">
              <div>
                <strong>🚗 ${escapeHTML(r.fromCity)} ➔ ${escapeHTML(r.toCity)}</strong> · <span style="color: var(--green); font-weight: 700;">${escapeHTML(r.price)} сом</span> ${r.isVip ? '<span class="vip-badge" style="margin-left: 6px;">🔥 VIP СРОЧНО</span>' : ''}<br>
                <small style="color: #6b7280; font-size: 13px;">📅 Дата: ${escapeHTML(r.date)} в ${escapeHTML(r.time)} | 💺 Свободных мест: ${escapeHTML(r.seats)} | 🚘 Авто: ${escapeHTML(r.car || "не указано")}</small><br>
                <small style="color: #4b5563; font-size: 13px;">👤 Водитель: <b>${escapeHTML(r.driverName)}</b> (📞 <a href="tel:${escapeHTML(r.phone)}">${escapeHTML(r.phone)}</a>)</small>
              </div>
              <div>
                <button type="button" class="secondary-button delete-ride-btn" data-ride-id="${r.id}" style="color: #dc2626; border-color: #fca5a5; padding: 6px 12px; font-size: 13px;">
                  Удалить поездку
                </button>
              </div>
            </div>
          `)
          .join("");
      }
    }

    // 3. Список посылок
    const parcelsList = $("#adminParcelsList");
    if (parcelsList) {
      const parcels = data.parcels || [];
      if (parcels.length === 0) {
        parcelsList.innerHTML = "<p style='color: #6b7280; font-size: 14px;'>Заявок на посылки в системе пока нет.</p>";
      } else {
        parcelsList.innerHTML = parcels
          .map((p) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; margin-bottom: 8px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; flex-wrap: wrap; gap: 10px;">
              <div>
                <strong>📦 ${escapeHTML(p.fromCity)} ➔ ${escapeHTML(p.toCity)}</strong> · <span class="profile-role-pill" style="font-size: 11px;">${escapeHTML(p.status === 'open' ? 'Открыта' : p.status)}</span> ${p.isVip ? '<span class="vip-badge" style="margin-left: 6px;">🔥 VIP СРОЧНО</span>' : ''}<br>
                <small style="color: #6b7280; font-size: 13px;">📅 Дата: ${escapeHTML(p.date)} | 📏 Размер: ${escapeHTML(p.size || "Стандарт")}</small><br>
                <small style="color: #4b5563; font-size: 13px;">📝 ${escapeHTML(p.description)}</small><br>
                <small style="color: #6b7280; font-size: 13px;">Отправитель: ${escapeHTML(p.senderName)} (📞 ${escapeHTML(p.senderPhone)}) ➔ Получатель: ${escapeHTML(p.recipientName)} (📞 ${escapeHTML(p.recipientPhone)})</small>
              </div>
              <div>
                <button type="button" class="secondary-button delete-parcel-btn" data-parcel-id="${p.id}" style="color: #dc2626; border-color: #fca5a5; padding: 6px 12px; font-size: 13px;">
                  Удалить заявку
                </button>
              </div>
            </div>
          `)
          .join("");
      }
    }

    // 4. Секция доходов, VIP услуг и пополнений баланса
    const paymentsList = $("#adminPaymentsList");
    if (paymentsList) {
      const transactions = data.transactions || [];
      const allTopups = data.topupRequests || [];
      const pendingTopups = allTopups.filter(r => r.status === "pending");

      paymentsList.innerHTML = `
        <!-- БЛОК ПРОВЕРКИ РЕАЛЬНЫХ ПЛАТЕЖЕЙ В MBANK -->
        <div style="background: #f0fdf4; border: 2px solid #059669; border-radius: 14px; padding: 18px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <h4 style="margin: 0; color: #065f46; font-size: 16px;">
              📲 Заявки на пополнение баланса (проверьте MBank перед подтверждением)
            </h4>
            <span style="background: ${pendingTopups.length > 0 ? '#dc2626' : '#10b981'}; color: white; padding: 3px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;">
              ${pendingTopups.length} новых заявок
            </span>
          </div>

          <p style="margin: 0 0 14px; font-size: 13px; color: #166534; line-height: 1.4;">
            Деньги <strong>НЕ начисляются автоматически</strong>. Проверьте поступление в MBank (получатель: <b>Нурпери.Э</b>) или О!Деньги (получатель: <b>Нурпери.Ж</b>) по номеру +996 700 30 31 33. Если перевод действительно поступил — нажмите «Зачислить».
          </p>

          ${pendingTopups.length === 0 ? `
            <div style="background: white; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 14px; text-align: center; color: #64748b; font-size: 13px;">
              ✓ Все поступившие переводы проверены. Новых заявок нет.
            </div>
          ` : pendingTopups.map(r => `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
              <div style="flex: 1; min-width: 240px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <strong style="font-size: 16px; color: #0f172a;">👤 ${escapeHTML(r.userName)}</strong>
                  <span style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: ${r.bank === 'О!Деньги' ? '#ffe4e6' : '#e0f2fe'}; color: ${r.bank === 'О!Деньги' ? '#be123c' : '#0369a1'};">
                    ${r.bank === 'О!Деньги' ? '📱 О!Деньги (Нурпери.Ж)' : '🏦 MBank (Нурпери.Э)'}
                  </span>
                </div>
                <div style="font-size: 13px; color: #475569; margin-bottom: 2px;">📞 <a href="tel:${escapeHTML(r.userPhone)}" style="color: #0369a1; text-decoration: none; font-weight: 600;">${escapeHTML(r.userPhone)}</a></div>
                <div style="font-size: 16px; font-weight: 800; color: #059669; margin: 4px 0;">Сумма перевода: ${r.amount} сом</div>
                <div style="color: #64748b; font-size: 12px;">
                  Данные плательщика: <b style="color: #1e293b; user-select: all;">${escapeHTML(r.senderInfo)}</b> · ${new Date(r.createdAt).toLocaleString("ru-RU")}
                </div>
                ${r.receipt ? `
                  <div style="margin-top: 10px;">
                    <div style="font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px;">🧾 Чек об оплате:</div>
                    <img src="${r.receipt}" alt="Чек" class="admin-receipt-preview" style="max-height: 95px; max-width: 160px; border-radius: 8px; border: 1px solid #cbd5e1; object-fit: contain; background: #f8fafc;" onclick="window.showReceiptModal('${r.receipt}')" />
                    <span style="font-size: 11px; color: #0284c7; display: block; margin-top: 2px; cursor: pointer;" onclick="window.showReceiptModal('${r.receipt}')">🔍 Нажмите для полноразмерного просмотра</span>
                  </div>
                ` : `
                  <div style="margin-top: 6px; font-size: 12px; color: #94a3b8; font-style: italic;">Чек не прикреплен к заявке</div>
                `}
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px; min-width: 160px;">
                <button type="button" class="primary-button small approve-topup-btn" data-request-id="${r.id}" style="background: #059669; border-color: #059669; padding: 10px 14px; font-size: 13px; font-weight: 700;">
                  ✅ Зачислить ${r.amount} сом
                </button>
                <button type="button" class="secondary-button small reject-topup-btn" data-request-id="${r.id}" style="color: #dc2626; border-color: #fca5a5; padding: 8px 14px; font-size: 13px;">
                  ❌ Отклонить
                </button>
              </div>
            </div>
          `).join("")}
        </div>

        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <strong style="color: #92400e; font-size: 16px;">🔥 Реальный доход от VIP услуг (50 сом):</strong>
              <span style="font-size: 22px; font-weight: 800; color: #b45309; margin-left: 6px;">${data.stats.vipIncome || 0} сом</span>
              <span style="color: #78350f; font-size: 13px;">(${data.stats.vipCount || 0} активаций VIP)</span>
            </div>
            <div>
              <span style="color: #065f46; background: #ecfdf5; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 700; border: 1px solid #a7f3d0;">
                ✓ Публикации бесплатны (0 сом)
              </span>
            </div>
          </div>
          <p style="margin: 8px 0 0; font-size: 13px; color: #78350f; line-height: 1.5;">
            Все поездки и посылки публикуются абсолютно бесплатно! Доход сервиса формируется от платного поднятия в топ (VIP за 50 сом). Всего подтверждённых пополнений баланса: <b>${data.stats.totalTopup || 0} сом</b>.
          </p>
        </div>

        <h4 style="margin: 16px 0 10px; font-size: 14px; text-transform: uppercase; color: #475569; letter-spacing: 0.5px;">📋 История подтверждённых операций и платежей</h4>
      ` + (transactions.length === 0 ? `
        <div style="padding: 16px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
          Подтверждённых платежей и поднятий в VIP пока не было.
        </div>
      ` : transactions.map(t => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; margin-bottom: 8px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong>${t.type === 'vip_boost' ? '🔥 Поднятие в VIP' : '💳 Пополнение баланса'}</strong>: ${escapeHTML(t.description || "")}<br>
            <small style="color: #6b7280; font-size: 12px;">Пользователь: <b>${escapeHTML(t.userName || "Пользователь")}</b> · ${new Date(t.createdAt).toLocaleString("ru-RU")}</small>
          </div>
          <div style="font-weight: 800; font-size: 15px; color: ${t.type === 'vip_boost' ? '#b45309' : '#059669'};">
            ${t.type === 'vip_boost' ? '+50 сом доход' : `+${t.amount} сом`}
          </div>
        </div>
      `).join(""));
    }
  } catch (error) {
    showToast(error.message);
    showPage("profile");
  }
}

// Переключение вкладок в панели администратора при клике на 4 карточки
document.addEventListener("click", (event) => {
  const statCard = event.target.closest("[data-admin-tab]");
  if (!statCard) return;

  document.querySelectorAll("[data-admin-tab]").forEach(c => c.classList.remove("active"));
  statCard.classList.add("active");

  const tab = statCard.dataset.adminTab;
  if ($("#adminTabUsers")) $("#adminTabUsers").style.display = tab === "users" ? "block" : "none";
  if ($("#adminTabRides")) $("#adminTabRides").style.display = tab === "rides" ? "block" : "none";
  if ($("#adminTabParcels")) $("#adminTabParcels").style.display = tab === "parcels" ? "block" : "none";
  if ($("#adminTabPayments")) $("#adminTabPayments").style.display = tab === "payments" ? "block" : "none";
});

// Обработка удаления пользователя администратором
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".delete-user-btn");
  if (!btn) return;

  const userId = Number(btn.dataset.userId);
  if (!confirm("Вы уверены, что хотите удалить этот профиль?")) return;

  btn.disabled = true;
  btn.textContent = "Удаление...";

  try {
    const res = await api("/api/admin", {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    });
    showToast(res.message || "Профиль удалён.");
    if (res.isSelf || (currentUser && currentUser.id === userId)) {
      currentUser = null;
      updateAccountButton();
      showPage("home");
    } else {
      await loadAdmin();
    }
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "Удалить профиль";
  }
});

// Обработка удаления поездки администратором
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".delete-ride-btn");
  if (!btn) return;

  const rideId = Number(btn.dataset.rideId);
  if (!confirm("Вы уверены, что хотите удалить эту поездку из системы?")) return;

  btn.disabled = true;
  btn.textContent = "Удаление...";

  try {
    const res = await api("/api/admin", {
      method: "DELETE",
      body: JSON.stringify({ rideId }),
    });
    showToast(res.message || "Поездка удалена.");
    await loadAdmin();
    loadHomeContent();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "Удалить поездку";
  }
});

// Обработка удаления посылки администратором
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".delete-parcel-btn");
  if (!btn) return;

  const parcelId = Number(btn.dataset.parcelId);
  if (!confirm("Вы уверены, что хотите удалить эту заявку на посылку?")) return;

  btn.disabled = true;
  btn.textContent = "Удаление...";

  try {
    const res = await api("/api/admin", {
      method: "DELETE",
      body: JSON.stringify({ parcelId }),
    });
    showToast(res.message || "Посылка удалена.");
    await loadAdmin();
    loadHomeContent();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "Удалить заявку";
  }
});

// Обработка удаления/отмены бронирования администратором
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".delete-booking-btn");
  if (!btn) return;

  const bookingId = Number(btn.dataset.bookingId);
  if (!confirm("Вы уверены, что хотите отменить это бронирование?")) return;

  btn.disabled = true;
  btn.textContent = "Отмена...";

  try {
    const res = await api("/api/admin", {
      method: "DELETE",
      body: JSON.stringify({ bookingId }),
    });
    showToast(res.message || "Бронирование отменено.");
    await loadAdmin();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "Отменить бронь";
  }
});

/* =====================================
   МУЛЬТИЯЗЫЧНОСТЬ (РУССКИЙ И КЫРГЫЗСКИЙ)
   ===================================== */

let currentLang = localStorage.getItem("nurpoput_lang") || "ru";

const I18N = {
  ru: {
    navHome: "Главная",
    navFind: "Найти поездку",
    navPublish: "Опубликовать",
    navParcels: "Посылки",
    navSafety: "Безопасность",
    navMessages: "💬 Сообщения",
    navNotifs: "🔔 Уведомления",
    navAdmin: "🛡️ Админ-панель",
    navLogin: "Войти",
    navProfile: "Мой профиль",
    heroBadge: "🇰🇬 Создано для Кыргызстана",
    heroTitle: "Дорога становится<br /><span>ближе вместе</span>",
    heroDesc: "Находи попутчиков, делись поездками и отправляй посылки между городами Кыргызстана.",
    heroPublishBtn: "🚗 Я водитель — создать поездку",
    heroParcelBtn: "📦 Отправить посылку",
    heroPopRoute: "Популярное направление",
    heroDepLabel: "Отправление",
    heroArrLabel: "Прибытие",
    heroEcoLabel: "Выгоднее вместе",
    homeSearchHeading: "🔍 Быстрый поиск маршрутов",
    lblHomeFrom: "Откуда",
    lblHomeTo: "Куда",
    lblHomeDate: "Дата поездки",
    lblHomePassengers: "Мест",
    btnHomeSearch: "Найти",
    btnHomeReset: "Все",
    tabRides: "🚗 Доступные поездки",
    tabParcels: "📦 Заказы на доставку",
    noRides: "Пока нет доступных поездок",
    noRidesSub: "Станьте первым водителем — опубликуйте поездку по Кыргызстану!",
    noParcels: "Пока нет доступных заказов на доставку",
    noParcelsSub: "Нужно передать посылку или груз? Создайте заказ прямо сейчас!",
    bookBtn: "Забронировать",
    callBtn: "Позвонить",
    takeParcelBtn: "Взять заказ",
    uploadPhotoBtn: "📷 Загрузить фото",
    changePhotoBtn: "📷 Сменить фото",
    profilePageTitle: "Личный кабинет",
    profileEyebrow: "ТВОЙ АККАУНТ",
    profileWelcome: "Добро пожаловать в NurPoput!",
    lblProfName: "Имя:",
    lblProfEmail: "Электронная почта:",
    lblProfPhone: "Телефон:",
    logoutBtn: "Выйти из аккаунта",
    ptabPassenger: "💺 Пассажир",
    ptabDriver: "🚗 Водитель",
    ptabParcels: "📦 Посылки",
    ptabNotifs: "🔔 Уведомления",
    lblMyBookings: "МОИ БРОНИРОВАНИЯ ПОЕЗДОК",
    lblMyRides: "МОИ ОПУБЛИКОВАННЫЕ ПОЕЗДКИ",
    lblDriverRequests: "ЗАЯВКИ ПАССАЖИРОВ НА МОИ ПОЕЗДКИ",
    lblMyParcels: "МОИ ПОСЫЛКИ",
    lblNotifsTitle: "УВЕДОМЛЕНИЯ",
    adminBannerTitle: "🛡️ Панель администратора доступна",
    adminBannerDesc: "Вы вошли как главный администратор. Вам доступно управление всеми пользователями, поездками и заказами сервиса.",
    btnAdminBannerGo: "🛡️ Открыть админку →",
    rolePassenger: "Пассажир",
    roleDriver: "Водитель",
    roleAdmin: "Администратор"
  },
  kg: {
    navHome: "Башкы бет",
    navFind: "Сапар табуу",
    navPublish: "Жол чыгаруу",
    navParcels: "Посылкалар",
    navSafety: "Коопсуздук",
    navMessages: "💬 Билдирүүлөр",
    navNotifs: "🔔 Билдирмелер",
    navAdmin: "🛡️ Админ-панел",
    navLogin: "Кирүү",
    navProfile: "Жеке кабинет",
    heroBadge: "🇰🇬 Кыргызстан үчүн түзүлгөн",
    heroTitle: "Бирге жол<br /><span>кыскарат</span>",
    heroDesc: "Кыргызстан шаарларынын ортосунда шериктерди тап, сапарларды бөлүш жана посылкаларды жөнөт.",
    heroPublishBtn: "🚗 Айдоочумун — сапар жарыялоо",
    heroParcelBtn: "📦 Посылка жөнөтүү",
    heroPopRoute: "Популярдуу багыт",
    heroDepLabel: "Чыгуу",
    heroArrLabel: "Келүү",
    heroEcoLabel: "Бирге үнөмдүү",
    homeSearchHeading: "🔍 Сапарларды тез издөө",
    lblHomeFrom: "Кайдан",
    lblHomeTo: "Кайда",
    lblHomeDate: "Күнү",
    lblHomePassengers: "Орун",
    btnHomeSearch: "Издөө",
    btnHomeReset: "Баары",
    tabRides: "🚗 Жеткиликтүү сапарлар",
    tabParcels: "📦 Жеткиликтүү посылкалар",
    noRides: "Азырынча жеткиликтүү сапарлар жок",
    noRidesSub: "Биринчи айдоочу болуңуз — Кыргызстан боюнча жаңы сапар жарыялаңыз!",
    noParcels: "Азырынча жеткиликтүү посылкалар жок",
    noParcelsSub: "Посылка же жүк жөнөтүү керекпи? Биринчи буйрутманы азыр түзүңүз!",
    bookBtn: "Орун ээлөө",
    callBtn: "Чалуу",
    takeParcelBtn: "Буйрутманы алуу",
    uploadPhotoBtn: "📷 Сүрөт жүктөө",
    changePhotoBtn: "📷 Сүрөттү алмаштыруу",
    profilePageTitle: "Жеке кабинет",
    profileEyebrow: "СИЗДИН АККАУНТУҢУЗ",
    profileWelcome: "NurPoput кызматына кош келдиңиз!",
    lblProfName: "Аты-жөнү:",
    lblProfEmail: "Электрондук почта:",
    lblProfPhone: "Телефон:",
    logoutBtn: "Аккаунттан чыгуу",
    ptabPassenger: "💺 Жүргүнчү",
    ptabDriver: "🚗 Айдоочу",
    ptabParcels: "📦 Посылкалар",
    ptabNotifs: "🔔 Билдирмелер",
    lblMyBookings: "МЕНИН ЭЭЛЕГЕН САПАРЛАРЫМ",
    lblMyRides: "МЕНИН ЖАРЫЯЛАГАН САПАРЛАРЫМ",
    lblDriverRequests: "МЕНИН САПАРЛАРЫМА ЖҮРГҮНЧҮЛӨРДҮН СУРАНЫМДАРЫ",
    lblMyParcels: "МЕНИН ПОСЫЛКАЛАРЫМ",
    lblNotifsTitle: "БИЛДИРМЕЛЕР",
    adminBannerTitle: "🛡️ Админ-панел ачык",
    adminBannerDesc: "Сиз башкы администраторсуз. Колдонуучуларды, сапарларды жана буйрутмаларды башкара аласыз.",
    btnAdminBannerGo: "🛡️ Админге кирүү →",
    rolePassenger: "Жүргүнчү",
    roleDriver: "Айдоочу",
    roleAdmin: "Администратор"
  }
};

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem("nurpoput_lang", lang);

  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });

  const t = I18N[lang] || I18N.ru;

  const navMap = {
    home: t.navHome,
    find: t.navFind,
    publish: t.navPublish,
    parcels: t.navParcels,
    safety: t.navSafety,
    admin: t.navAdmin
  };
  Object.entries(navMap).forEach(([page, text]) => {
    const el = document.querySelector(`.navigation [data-page='${page}']`);
    if (el) el.textContent = text;
  });

  if ($("#heroBadge")) $("#heroBadge").textContent = t.heroBadge;
  if ($("#heroTitle")) $("#heroTitle").innerHTML = t.heroTitle;
  if ($("#heroDesc")) $("#heroDesc").textContent = t.heroDesc;
  if ($("#heroPublishBtn")) $("#heroPublishBtn").textContent = t.heroPublishBtn;
  if ($("#heroParcelBtn")) $("#heroParcelBtn").textContent = t.heroParcelBtn;
  if ($("#heroPopRoute")) $("#heroPopRoute").textContent = t.heroPopRoute;
  if ($("#heroDepLabel")) $("#heroDepLabel").textContent = t.heroDepLabel;
  if ($("#heroArrLabel")) $("#heroArrLabel").textContent = t.heroArrLabel;
  if ($("#heroEcoLabel")) $("#heroEcoLabel").textContent = t.heroEcoLabel;

  if ($("#homeSearchHeading")) $("#homeSearchHeading").textContent = t.homeSearchHeading;
  if ($("#lblHomeFrom")) $("#lblHomeFrom").textContent = t.lblHomeFrom;
  if ($("#lblHomeTo")) $("#lblHomeTo").textContent = t.lblHomeTo;
  if ($("#lblHomeDate")) $("#lblHomeDate").textContent = t.lblHomeDate;
  if ($("#lblHomePassengers")) $("#lblHomePassengers").textContent = t.lblHomePassengers;
  if ($("#btnHomeSearch")) $("#btnHomeSearch").textContent = t.btnHomeSearch;
  if ($("#btnHomeReset")) $("#btnHomeReset").textContent = t.btnHomeReset;

  if ($("#profilePageTitle")) $("#profilePageTitle").textContent = t.profilePageTitle;
  if ($("#profileEyebrow")) $("#profileEyebrow").textContent = t.profileEyebrow;
  if ($("#profileWelcome") && currentUser) {
    $("#profileWelcome").textContent = (lang === "kg" ? "Кош келдиңиз, " : "Добро пожаловать, ") + currentUser.name + "!";
  }
  if ($("#lblProfName")) $("#lblProfName").textContent = t.lblProfName;
  if ($("#lblProfEmail")) $("#lblProfEmail").textContent = t.lblProfEmail;
  if ($("#lblProfPhone")) $("#lblProfPhone").textContent = t.lblProfPhone;
  if ($("#logoutButton")) $("#logoutButton").textContent = t.logoutBtn;

  if ($("#ptabPassenger")) $("#ptabPassenger").textContent = t.ptabPassenger;
  if ($("#ptabDriver")) $("#ptabDriver").textContent = t.ptabDriver;
  if ($("#ptabParcels")) $("#ptabParcels").textContent = t.ptabParcels;
  if ($("#ptabNotifs")) $("#ptabNotifs").textContent = t.ptabNotifs;

  if ($("#lblMyBookings")) $("#lblMyBookings").textContent = t.lblMyBookings;
  if ($("#lblMyRides")) $("#lblMyRides").textContent = t.lblMyRides;
  if ($("#lblDriverRequests")) $("#lblDriverRequests").textContent = t.lblDriverRequests;
  if ($("#lblMyParcels")) $("#lblMyParcels").textContent = t.lblMyParcels;
  if ($("#lblNotifsTitle")) $("#lblNotifsTitle").textContent = t.lblNotifsTitle;

  updateAccountButton();
  renderAvatar();
  loadHomeContent();
}

document.querySelectorAll(".lang-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    applyLanguage(btn.dataset.lang);
  });
});

/* =====================================
   ГЛАВНАЯ СТРАНИЦА: ПОЕЗДКИ И ПОСЫЛКИ
   ===================================== */

async function loadHomeContent(filterParams = {}) {
  await Promise.all([loadHomeRides(filterParams), loadHomeParcels()]);
}

async function loadHomeRides(filters = {}) {
  const container = $("#homeRidesList");
  if (!container) return;
  const countEl = $("#homeRidesCount");

  const queryParams = new URLSearchParams();
  if (filters.from) queryParams.set("from", filters.from);
  if (filters.to) queryParams.set("to", filters.to);
  if (filters.date) queryParams.set("date", filters.date);
  if (filters.time) queryParams.set("time", filters.time);
  if (filters.passengers && filters.passengers > 1) queryParams.set("passengers", String(filters.passengers));
  if (filters.carClass) queryParams.set("carClass", filters.carClass);

  try {
    const data = await api("/api/rides?" + queryParams.toString());
    const rides = data.rides || [];
    if (countEl) countEl.textContent = rides.length;

    if (rides.length === 0) {
      container.innerHTML = `
        <div class="empty-state car-search-empty-state" style="grid-column: 1 / -1; padding: 40px 20px;">
          <div style="font-size: 42px; margin-bottom: 10px;">🚙</div>
          <h3>${currentLang === "kg" ? "Азырынча ылайыктуу машина жок" : "Подходящих машин пока не найдено"}</h3>
          <p style="max-width: 440px; margin: 0 auto 16px; color: #64748b;">
            ${currentLang === "kg" ? "Бул багыт боюнча сапар чыкканда сизге дароо билдирме келет. Өтүнмө калтырыңыз!" : "Оставьте заявку на поиск машины — мы сразу уведомим вас при появлении подходящей поездки!"}
          </p>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="primary-button btn-save-ride-request btn-open-request-modal">
              🔔 ${currentLang === "kg" ? "Унаа издөөгө өтүнмө калтыруу" : "Оставить заявку на поиск машины"}
            </button>
            <button type="button" class="secondary-button" data-page="publish">
              ${currentLang === "kg" ? "🚗 Өзүм сапар жарыялоо" : "🚗 Опубликовать поездку водителем"}
            </button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = rides.map(ride => {
      const isVip = Boolean(ride.isVip);
      const isMyRide = currentUser && currentUser.id === ride.driverId;
      const seatsLeft = Number(ride.seats) || 0;
      const isFull = seatsLeft <= 0;

      return `
        <article class="card-item ${isVip ? 'is-vip' : ''}">
          <div class="card-route">
            <div class="card-route-cities">
              <span>${escapeHTML(ride.fromCity)}</span>
              <span style="color: var(--green);">➔</span>
              <span>${escapeHTML(ride.toCity)}</span>
              ${isVip ? '<span class="vip-badge" style="margin-left: 6px;">🔥 VIP СРОЧНО</span>' : ''}
            </div>
            <div class="card-price">${escapeHTML(ride.price)} сом</div>
          </div>

          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; margin-bottom: 8px;">
            ${getCarClassBadge(ride.carClass)}
            ${ride.carPlate ? `<span class="car-plate-badge">${escapeHTML(ride.carPlate)}</span>` : ""}
            <span style="font-size: 13px; font-weight: 600; color: #334155;">🚗 ${escapeHTML(ride.carBrand || "")} ${escapeHTML(ride.carModel || ride.car || "Авто")}</span>
            ${ride.carColor ? `<span class="car-color-tag">🎨 ${escapeHTML(ride.carColor)}</span>` : ""}
          </div>

          <div class="card-details-grid">
            <div>📅 ${escapeHTML(ride.date)}</div>
            <div>🕒 ${escapeHTML(ride.time || "Удобное")}</div>
            <div style="grid-column: span 2;">
              <span class="seats-badge ${isFull ? 'full' : ''}">
                💺 ${isFull ? 'Все места заняты' : `Свободно: ${seatsLeft} ${currentLang === "kg" ? "орун" : "мест"}`}
              </span>
            </div>
          </div>
          <div style="font-size: 14px; color: #495057; border-top: 1px solid #f8f9fa; padding-top: 8px;">
            <strong>👤 ${currentLang === "kg" ? "Айдоочу" : "Водитель"}:</strong> ${escapeHTML(ride.driverName)} · 📞 <a href="tel:${escapeHTML(ride.phone)}" style="color: var(--green); text-decoration: none; font-weight: 700;">${escapeHTML(ride.phone)}</a>
          </div>
          ${ride.comment ? `<p style="font-size: 13px; color: #6c757d; margin: 0; font-style: italic;">«${escapeHTML(ride.comment)}»</p>` : ""}
          ${isMyRide ? `
            <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
              ${!isVip ? `
                <button type="button" class="btn-boost-vip boost-ride-btn" data-ride-id="${ride.id}" style="width: 100%; justify-content: center;">
                  🔥 Поднять поездку в VIP (50 сом)
                </button>
              ` : `
                <div style="color: #059669; font-size: 13px; font-weight: 700; text-align: center; padding: 4px;">✓ Ваша поездка закреплена в VIP топе</div>
              `}
              <div style="display: flex; gap: 6px;">
                <button type="button" class="secondary-button btn-archive-my-ride" data-ride-id="${ride.id}" style="flex: 1; font-size: 12px; padding: 6px; color: #065f46; border-color: #a7f3d0; background: #ecfdf5;">
                  ✅ Клиенты найдены (в архив)
                </button>
                <button type="button" class="secondary-button btn-delete-my-ride" data-ride-id="${ride.id}" style="font-size: 12px; padding: 6px 10px; color: #dc2626; border-color: #fca5a5; background: #fef2f2;">
                  🗑️ Удалить
                </button>
              </div>
            </div>
          ` : (currentUser && currentUser.role === 'admin' ? `
            <div style="margin-top: 6px;">
              <button type="button" class="secondary-button btn-delete-my-ride" data-ride-id="${ride.id}" style="width: 100%; font-size: 12px; padding: 6px; color: #dc2626; border-color: #fca5a5; background: #fef2f2;">
                🗑️ Удалить поездку (Администратор)
              </button>
            </div>
          ` : '')}
          <div class="card-actions">
            ${!isFull ? `
              <button type="button" class="primary-button book-ride-button" data-ride-id="${escapeHTML(ride.id)}">
                ${currentLang === "kg" ? "Орун ээлөө" : "💺 Забронировать"}
              </button>
            ` : `
              <button type="button" class="secondary-button" disabled style="opacity: 0.6; cursor: not-allowed;">
                🔒 Мест нет
              </button>
            `}
            <a href="tel:${escapeHTML(ride.phone)}" class="secondary-button" style="text-decoration: none;">
              📞 ${currentLang === "kg" ? "Чалуу" : "Позвонить"}
            </a>
          </div>
        </article>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<p class="form-message">${escapeHTML(err.message)}</p>`;
  }
}

async function loadHomeParcels() {
  const container = $("#homeParcelsList");
  if (!container) return;
  const countEl = $("#homeParcelsCount");

  try {
    const data = await api("/api/parcels");
    const parcels = data.parcels || [];
    if (countEl) countEl.textContent = parcels.length;

    if (parcels.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px;">
          <div style="font-size: 42px; margin-bottom: 10px;">📦</div>
          <h3>${currentLang === "kg" ? "Азырынча жеткиликтүү посылкалар жок" : "Пока нет доступных заказов на доставку"}</h3>
          <p>${currentLang === "kg" ? "Посылка же жүк жөнөтүү керекпи? Биринчи буйрутманы азыр түзүңүз!" : "Нужно передать посылку или груз? Создайте заказ прямо сейчас!"}</p>
          <button type="button" class="secondary-button" data-page="parcels" style="margin-top: 14px;">
            ${currentLang === "kg" ? "📦 Посылка жөнөтүү" : "📦 Создать заявку на посылку"}
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = parcels.map(parcel => {
      const isVip = Boolean(parcel.isVip);
      const isMyParcel = currentUser && currentUser.id === parcel.ownerId;
      return `
        <article class="card-item ${isVip ? 'is-vip' : ''}">
          <div class="card-route">
            <div class="card-route-cities">
              <span>📦 ${escapeHTML(parcel.fromCity)}</span>
              <span style="color: var(--green);">➔</span>
              <span>${escapeHTML(parcel.toCity)}</span>
              ${isVip ? '<span class="vip-badge" style="margin-left: 6px;">🔥 VIP СРОЧНО</span>' : ''}
            </div>
            <div class="profile-role-pill" style="font-size: 12px;">${escapeHTML(parcel.status === "open" ? (currentLang === "kg" ? "Ачык" : "Открыт") : parcel.status)}</div>
          </div>
          <div class="card-details-grid">
            <div>📅 ${escapeHTML(parcel.date)}</div>
            <div>📏 ${escapeHTML(parcel.size || "Стандарт")}</div>
          </div>
          <div style="font-size: 13px; color: #495057;">
            <strong>📝 ${currentLang === "kg" ? "Сүрөттөлүшү" : "Описание"}:</strong> ${escapeHTML(parcel.description)}
          </div>
          <div style="font-size: 13px; color: #6c757d;">
            👤 ${currentLang === "kg" ? "Жөнөтүүчү" : "Отправитель"}: ${escapeHTML(parcel.senderName)} · 📞 <a href="tel:${escapeHTML(parcel.senderPhone)}">${escapeHTML(parcel.senderPhone)}</a>
          </div>
          ${isMyParcel && !isVip ? `
            <div style="margin-top: 4px;">
              <button type="button" class="btn-boost-vip boost-parcel-btn" data-parcel-id="${parcel.id}" style="width: 100%; justify-content: center;">
                🔥 Поднять посылку в VIP (50 сом)
              </button>
            </div>
          ` : ''}
          <div class="card-actions">
            <button type="button" class="primary-button take-parcel-btn" data-parcel-id="${parcel.id}">
              ${currentLang === "kg" ? "📦 Буйрутманы алуу" : "📦 Взять заказ"}
            </button>
            <a href="tel:${escapeHTML(parcel.senderPhone)}" class="secondary-button" style="text-decoration: none;">
              📞 ${currentLang === "kg" ? "Чалуу" : "Позвонить"}
            </a>
          </div>
        </article>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<p class="form-message">${escapeHTML(err.message)}</p>`;
  }
}

// Форма быстрого поиска на главной странице
$("#homeSearchForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const from = $("#homeSearchFrom")?.value || "";
  const to = $("#homeSearchTo")?.value || "";
  const date = $("#homeSearchDate")?.value || "";
  const time = $("#homeSearchTime")?.value || "";
  const passengers = Number($("#homeSearchPassengers")?.value || 1);
  const carClass = $("#homeSearchCarClass")?.value || "";

  if (from && to && from === to) {
    showToast(currentLang === "kg" ? "Чыгуу жана келүү шаарлары айырмаланышы керек." : "Город отправления и назначения должны отличаться.");
    return;
  }
  loadHomeRides({ from, to, date, time, passengers, carClass });
});

$("#btnHomeReset")?.addEventListener("click", () => {
  if ($("#homeSearchFrom")) $("#homeSearchFrom").value = "";
  if ($("#homeSearchTo")) $("#homeSearchTo").value = "";
  if ($("#homeSearchDate")) $("#homeSearchDate").value = "";
  if ($("#homeSearchTime")) $("#homeSearchTime").value = "";
  if ($("#homeSearchPassengers")) $("#homeSearchPassengers").value = "1";
  if ($("#homeSearchCarClass")) $("#homeSearchCarClass").value = "";
  loadHomeRides({});
});

// Переключатель вкладок: Поездки / Посылки на главной странице
$("#tabHomeRides")?.addEventListener("click", () => {
  $("#tabHomeRides")?.classList.add("active");
  $("#tabHomeParcels")?.classList.remove("active");
  if ($("#homeRidesSection")) $("#homeRidesSection").style.display = "block";
  if ($("#homeParcelsSection")) $("#homeParcelsSection").style.display = "none";
});

$("#tabHomeParcels")?.addEventListener("click", () => {
  $("#tabHomeParcels")?.classList.add("active");
  $("#tabHomeRides")?.classList.remove("active");
  if ($("#homeParcelsSection")) $("#homeParcelsSection").style.display = "block";
  if ($("#homeRidesSection")) $("#homeRidesSection").style.display = "none";
});

// Вкладки в личном кабинете
document.querySelectorAll("[data-prof-tab]").forEach(tabBtn => {
  tabBtn.addEventListener("click", () => {
    document.querySelectorAll("[data-prof-tab]").forEach(b => b.classList.remove("active"));
    tabBtn.classList.add("active");
    const target = tabBtn.dataset.profTab;
    if ($("#profTabContentPassenger")) $("#profTabContentPassenger").style.display = target === "passenger" ? "block" : "none";
    if ($("#profTabContentDriver")) $("#profTabContentDriver").style.display = target === "driver" ? "block" : "none";
    if ($("#profTabContentParcels")) $("#profTabContentParcels").style.display = target === "parcels" ? "block" : "none";
    if ($("#profTabContentNotifs")) $("#profTabContentNotifs").style.display = target === "notifications" ? "block" : "none";
  });
});

/* =====================================
   БАЛАНС И VIP УСЛУГИ (50 СОМ)
   ===================================== */

let selectedTopupBank = "MBank";
let currentReceiptBase64 = null;

function compressImage(file, maxDimension = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.showReceiptModal = function(url) {
  const modal = $("#receiptModal");
  const img = $("#receiptModalImg");
  if (modal && img) {
    img.src = url;
    modal.style.display = "flex";
  }
};

$("#btnCloseReceiptModal")?.addEventListener("click", () => {
  if ($("#receiptModal")) $("#receiptModal").style.display = "none";
});

$("#receiptModal")?.addEventListener("click", (e) => {
  if (e.target === $("#receiptModal")) {
    $("#receiptModal").style.display = "none";
  }
});

function openTopupModal(defaultAmount = 50) {
  const modal = $("#topupModal");
  if (!modal) return;
  const input = $("#topupCustomAmount");
  if (input) input.value = defaultAmount;
  setMessage("#topupModalMessage", "");
  document.querySelectorAll(".topup-preset-btn").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.amount) === defaultAmount);
  });
  modal.style.display = "flex";
}

function closeTopupModal() {
  const modal = $("#topupModal");
  if (modal) modal.style.display = "none";
}

// Переключение банков
$("#btnSelectMBank")?.addEventListener("click", () => {
  selectedTopupBank = "MBank";
  $("#btnSelectMBank")?.classList.add("active");
  $("#btnSelectODengi")?.classList.remove("active");
  if ($("#bankRecipientNotice")) {
    $("#bankRecipientNotice").innerHTML = "Получатель в MBank: <b>Нурпери.Э</b>";
  }
  if ($("#lblTopupSender")) {
    $("#lblTopupSender").textContent = "Ваш номер или имя отправителя в MBank:";
  }
});

$("#btnSelectODengi")?.addEventListener("click", () => {
  selectedTopupBank = "О!Деньги";
  $("#btnSelectODengi")?.classList.add("active");
  $("#btnSelectMBank")?.classList.remove("active");
  if ($("#bankRecipientNotice")) {
    $("#bankRecipientNotice").innerHTML = "Получатель в О!Деньги: <b>Нурпери.Ж</b>";
  }
  if ($("#lblTopupSender")) {
    $("#lblTopupSender").textContent = "Ваш номер или имя отправителя в О!Деньги:";
  }
});

// Кнопка копирования номера телефона
$("#btnCopyPhone")?.addEventListener("click", () => {
  const phone = "0700303133";
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(phone).then(() => {
      showToast("Номер 0700303133 скопирован в буфер обмена!");
    }).catch(() => {
      prompt("Скопируйте номер телефона:", phone);
    });
  } else {
    prompt("Скопируйте номер телефона:", phone);
  }
});

// Быстрый запуск мобильного приложения MBank
$("#btnLaunchMBank")?.addEventListener("click", () => {
  const isAndroid = /android/i.test(navigator.userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isAndroid) {
    window.location.href = "intent://#Intent;package=com.cbk.mbank;scheme=mbank;end";
    setTimeout(() => { window.open("https://app.mbank.kg/", "_blank"); }, 1200);
  } else if (isIOS) {
    window.location.href = "mbank://";
    setTimeout(() => { window.open("https://apps.apple.com/app/mbank/id1527771746", "_blank"); }, 1200);
  } else {
    window.open("https://app.mbank.kg/", "_blank");
  }
});

// Быстрый запуск мобильного приложения О!Деньги
$("#btnLaunchODengi")?.addEventListener("click", () => {
  const isAndroid = /android/i.test(navigator.userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isAndroid) {
    window.location.href = "intent://#Intent;package=kg.o.nurtelecom;scheme=odengi;end";
    setTimeout(() => { window.open("https://dengi.o.kg/", "_blank"); }, 1200);
  } else if (isIOS) {
    window.location.href = "odengi://";
    setTimeout(() => { window.open("https://apps.apple.com/app/o-dengi/id1435471465", "_blank"); }, 1200);
  } else {
    window.open("https://dengi.o.kg/", "_blank");
  }
});

// Загрузка скриншота чека
$("#receiptDropBox")?.addEventListener("click", (e) => {
  if (e.target.id === "btnRemoveReceipt") return;
  $("#topupReceiptFile")?.click();
});

$("#topupReceiptFile")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    currentReceiptBase64 = await compressImage(file);
    const img = $("#receiptPreviewImg");
    if (img) img.src = currentReceiptBase64;
    if ($("#receiptPlaceholder")) $("#receiptPlaceholder").style.display = "none";
    if ($("#receiptPreviewBox")) $("#receiptPreviewBox").style.display = "block";
    showToast("Чек об оплате прикреплен!");
  } catch (err) {
    console.error(err);
    showToast("Не удалось обработать фото чека", true);
  }
});

$("#btnRemoveReceipt")?.addEventListener("click", (e) => {
  e.stopPropagation();
  currentReceiptBase64 = null;
  const input = $("#topupReceiptFile");
  if (input) input.value = "";
  if ($("#receiptPreviewImg")) $("#receiptPreviewImg").src = "";
  if ($("#receiptPlaceholder")) $("#receiptPlaceholder").style.display = "block";
  if ($("#receiptPreviewBox")) $("#receiptPreviewBox").style.display = "none";
});

$("#btnOpenTopupModal")?.addEventListener("click", () => {
  if (!currentUser) {
    showToast("Сначала войдите в аккаунт.");
    setAuthMode("login");
    showPage("auth");
    return;
  }
  openTopupModal(50);
});

$("#btnCloseTopupModal")?.addEventListener("click", closeTopupModal);

$("#topupModal")?.addEventListener("click", (e) => {
  if (e.target === $("#topupModal")) {
    closeTopupModal();
  }
});

document.querySelectorAll(".topup-preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".topup-preset-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const amount = Number(btn.dataset.amount);
    if ($("#topupCustomAmount")) $("#topupCustomAmount").value = amount;
  });
});

$("#btnSubmitTopup")?.addEventListener("click", async () => {
  const amount = Number($("#topupCustomAmount")?.value);
  if (!amount || amount < 10) {
    setMessage("#topupModalMessage", "Минимальная сумма — 10 сом.", true);
    return;
  }

  const senderInfo = $("#topupSenderInfo")?.value.trim();
  if (!senderInfo || senderInfo.length < 2) {
    setMessage("#topupModalMessage", "Укажите номер телефона или имя из перевода в банке.", true);
    return;
  }

  const btn = $("#btnSubmitTopup");
  btn.disabled = true;
  btn.textContent = "Отправка заявки...";

  try {
    const res = await api("/api/balance/topup-request", {
      method: "POST",
      body: JSON.stringify({
        amount,
        senderInfo,
        bank: selectedTopupBank,
        receipt: currentReceiptBase64
      })
    });

    showToast("Заявка на пополнение отправлена администратору!");
    alert(res.message || "Заявка на пополнение отправлена администратору! После сверки чека деньги поступят на баланс.");
    if ($("#topupSenderInfo")) $("#topupSenderInfo").value = "";
    currentReceiptBase64 = null;
    if ($("#topupReceiptFile")) $("#topupReceiptFile").value = "";
    if ($("#receiptPreviewImg")) $("#receiptPreviewImg").src = "";
    if ($("#receiptPlaceholder")) $("#receiptPlaceholder").style.display = "block";
    if ($("#receiptPreviewBox")) $("#receiptPreviewBox").style.display = "none";
    closeTopupModal();
    if (currentPage === "profile") await loadProfile();
  } catch (err) {
    setMessage("#topupModalMessage", err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "📩 Я оплатил(а) — отправить на проверку";
  }
});

// Подтверждение платежа администратором (реальное зачисление средств)
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".approve-topup-btn");
  if (!btn) return;

  const requestId = Number(btn.dataset.requestId);
  if (!confirm("Вы проверили поступление реальных денег на ваш MBank (+996 700 30 31 33) и готовы зачислить сумму?")) return;

  btn.disabled = true;
  btn.textContent = "Зачисляем...";

  try {
    const res = await api("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "approve_topup", requestId })
    });
    showToast(res.message);
    alert(res.message);
    await loadAdmin();
    if (currentPage === "profile") await loadProfile();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "✅ Зачислить";
  }
});

// Отклонение заявки администратором (деньги не поступили)
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".reject-topup-btn");
  if (!btn) return;

  const requestId = Number(btn.dataset.requestId);
  if (!confirm("Отклонить эту заявку? (Деньги в MBank не поступали)")) return;

  btn.disabled = true;
  btn.textContent = "Отклоняем...";

  try {
    const res = await api("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "reject_topup", requestId })
    });
    showToast(res.message);
    await loadAdmin();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "❌ Отклонить";
  }
});

// Клик по кнопке "🔥 Поднять в VIP (50 сом)" для поездки
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".boost-ride-btn");
  if (!btn) return;

  const rideId = Number(btn.dataset.rideId);
  if (!currentUser) {
    showToast("Сначала войдите в аккаунт.");
    setAuthMode("login");
    showPage("auth");
    return;
  }

  if ((currentUser.balance || 0) < 50) {
    showToast("Недостаточно средств. Для VIP требуется 50 сом. Пополните баланс.");
    openTopupModal(50);
    return;
  }

  if (!confirm("Поднять поездку в VIP за 50 сом? Она появится на 1 месте в списке со значком 🔥 VIP СРОЧНО.")) return;

  btn.disabled = true;
  btn.textContent = "Активация...";

  try {
    const res = await api("/api/vip/boost", {
      method: "POST",
      body: JSON.stringify({ rideId })
    });

    showToast(res.message);
    if (res.balance !== undefined && currentUser) {
      currentUser.balance = res.balance;
      if ($("#profileBalanceValue")) $("#profileBalanceValue").textContent = res.balance;
    }
    await loadHomeContent();
    if (currentPage === "profile") await loadProfile();
  } catch (err) {
    if (err.needTopup || err.status === 402) {
      showToast(err.message, true);
      openTopupModal(50);
    } else {
      showToast(err.message, true);
    }
    btn.disabled = false;
    btn.textContent = "🔥 Поднять в VIP (50 сом)";
  }
});

// Клик по кнопке "🔥 Поднять в VIP (50 сом)" для посылки
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".boost-parcel-btn");
  if (!btn) return;

  const parcelId = Number(btn.dataset.parcelId);
  if (!currentUser) {
    showToast("Сначала войдите в аккаунт.");
    setAuthMode("login");
    showPage("auth");
    return;
  }

  if ((currentUser.balance || 0) < 50) {
    showToast("Недостаточно средств. Для VIP требуется 50 сом. Пополните баланс.");
    openTopupModal(50);
    return;
  }

  if (!confirm("Поднять заказ на посылку в VIP за 50 сом? Он появится на 1 месте в списке.")) return;

  btn.disabled = true;
  btn.textContent = "Активация...";

  try {
    const res = await api("/api/vip/boost", {
      method: "POST",
      body: JSON.stringify({ parcelId })
    });

    showToast(res.message);
    if (res.balance !== undefined && currentUser) {
      currentUser.balance = res.balance;
      if ($("#profileBalanceValue")) $("#profileBalanceValue").textContent = res.balance;
    }
    await loadHomeContent();
    if (currentPage === "profile") await loadProfile();
  } catch (err) {
    if (err.needTopup || err.status === 402) {
      showToast(err.message, true);
      openTopupModal(50);
    } else {
      showToast(err.message, true);
    }
    btn.disabled = false;
    btn.textContent = "🔥 Поднять в VIP (50 сом)";
  }
});

// Начисление баланса администратором пользователю
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".admin-add-balance-btn");
  if (!btn) return;

  const userId = Number(btn.dataset.userId);
  const amount = Number(btn.dataset.amount);

  btn.disabled = true;
  try {
    const res = await api("/api/admin", {
      method: "POST",
      body: JSON.stringify({ action: "adjust_balance", userId, amount })
    });
    showToast(res.message);
    await loadAdmin();
    if (currentUser && currentUser.id === userId) {
      currentUser.balance = res.balance;
      if ($("#profileBalanceValue")) $("#profileBalanceValue").textContent = res.balance;
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

/* =====================================
   ЗАПУСК САЙТА
   ===================================== */

async function initializeSite() {
  fillCitySelects();
  setMinimumDates();

  try {
    const data = await api("/api/auth");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  updateAccountButton();
  refreshBadges();
  setInterval(refreshBadges, 60000);

  // Применяем сохранённый язык
  applyLanguage(currentLang);

  const params = new URLSearchParams(location.search);
  const resetCode = params.get("reset");

  if (resetCode) {
    prefillReset(resetCode);
    initGoogle();
    return;
  }

  const pageParam = params.get("page");

  if (pageParam === "find") {
    const from = params.get("from");
    const to = params.get("to");
    const date = params.get("date");

    if (from && $("#searchFrom")) $("#searchFrom").value = from;
    if (to && $("#searchTo")) $("#searchTo").value = to;
    if (date && $("#searchDate")) $("#searchDate").value = date;
  }

  if (pageParam && pageIds[pageParam]) {
    showPage(pageParam);
  } else {
    showPage("home");
  }

  initGoogle();
}

initializeSite();

/* =====================================
   PWA: УСТАНОВКА И СКАЧИВАНИЕ ПРИЛОЖЕНИЯ
   ===================================== */
let deferredPrompt = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = $("#pwaInstallBanner");
  if (banner && !sessionStorage.getItem("pwa_banner_closed")) {
    banner.style.display = "flex";
  }
});

async function triggerAppInstall() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      showToast("Спасибо за установку NurPoput!");
      const banner = $("#pwaInstallBanner");
      if (banner) banner.style.display = "none";
    }
    deferredPrompt = null;
  } else if (isIos) {
    const iosModal = $("#iosInstallModal");
    if (iosModal) iosModal.style.display = "flex";
  } else {
    alert("Для установки приложения нажмите «Добавить на главный экран» или иконку установки в адресной строке браузера (Chrome / Safari / Edge).");
  }
}

$("#btnPwaInstall")?.addEventListener("click", triggerAppInstall);
$("#navInstallAppBtn")?.addEventListener("click", triggerAppInstall);

$("#btnPwaClose")?.addEventListener("click", () => {
  const banner = $("#pwaInstallBanner");
  if (banner) banner.style.display = "none";
  sessionStorage.setItem("pwa_banner_closed", "1");
});

$("#btnCloseIosModal")?.addEventListener("click", () => {
  const iosModal = $("#iosInstallModal");
  if (iosModal) iosModal.style.display = "none";
});

$("#iosInstallModal")?.addEventListener("click", (e) => {
  if (e.target === $("#iosInstallModal")) {
    $("#iosInstallModal").style.display = "none";
  }
});

/* =====================================
   УПРАВЛЕНИЕ ПОЕЗДКАМИ: АРХИВ И УДАЛЕНИЕ
   ===================================== */

// Переключение вкладок в профиле водителя (Активные / Архив)
document.addEventListener("click", (e) => {
  const activeBtn = e.target.closest("#btnDriverTabActive");
  const archiveBtn = e.target.closest("#btnDriverTabArchive");

  if (activeBtn) {
    $("#btnDriverTabActive")?.classList.add("active");
    $("#btnDriverTabArchive")?.classList.remove("active");
    if ($("#profileRides")) $("#profileRides").style.display = "block";
    if ($("#profileRidesArchive")) $("#profileRidesArchive").style.display = "none";
  }

  if (archiveBtn) {
    $("#btnDriverTabArchive")?.classList.add("active");
    $("#btnDriverTabActive")?.classList.remove("active");
    if ($("#profileRides")) $("#profileRides").style.display = "none";
    if ($("#profileRidesArchive")) $("#profileRidesArchive").style.display = "block";
  }
});

// Клик по кнопке "Клиенты найдены (в архив)"
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-archive-my-ride");
  if (!btn) return;
  const rideId = Number(btn.dataset.rideId);
  if (!confirm("Клиенты найдены? Переместить поездку в архив? Она перестанет отображаться в общем поиске.")) return;

  btn.disabled = true;
  btn.textContent = "Сохраняем...";
  try {
    const res = await api("/api/rides/archive", {
      method: "POST",
      body: JSON.stringify({ rideId })
    });
    showToast(res.message || "Поездка успешно перемещена в архив!");
    await loadHomeContent();
    if (currentPage === "profile") await loadProfile();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "✅ Клиенты найдены (в архив)";
  }
});

// Клик по кнопке "Удалить поездку" (для водителя и администратора)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-delete-my-ride");
  if (!btn) return;
  const rideId = Number(btn.dataset.rideId);
  if (!confirm("Вы уверены, что хотите удалить эту поездку? Она будет удалена навсегда.")) return;

  btn.disabled = true;
  btn.textContent = "Удаление...";
  try {
    let res;
    if (currentUser && currentUser.role === "admin") {
      res = await api("/api/admin", {
        method: "DELETE",
        body: JSON.stringify({ rideId })
      });
    } else {
      res = await api("/api/rides", {
        method: "DELETE",
        body: JSON.stringify({ rideId })
      });
    }
    showToast(res.message || "Поездка удалена");
    await loadHomeContent();
    if (currentPage === "profile") await loadProfile();
    if (currentPage === "admin" && typeof loadAdmin === "function") await loadAdmin();
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
    btn.textContent = "🗑️ Удалить поездку";
  }
});
