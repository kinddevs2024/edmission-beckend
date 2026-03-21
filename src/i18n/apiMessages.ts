export const supportedApiLocales = ['en', 'ru', 'uz'] as const;

export type ApiLocale = (typeof supportedApiLocales)[number];

type LocalizedText = Record<ApiLocale, string>;

type TranslationResult = {
  text: string;
};

type RegexHandler = (match: RegExpMatchArray, locale: ApiLocale) => string;

const fieldLabels: Record<string, LocalizedText> = {
  id: { en: 'id', ru: 'ID', uz: 'ID' },
  url: { en: 'URL', ru: 'URL', uz: 'URL' },
  fileUrl: { en: 'file URL', ru: 'URL файла', uz: 'fayl URLi' },
  canvasJson: { en: 'document layout', ru: 'макет документа', uz: 'hujjat maketi' },
  decision: { en: 'decision', ru: 'решение', uz: 'qaror' },
  email: { en: 'email', ru: 'email', uz: 'email' },
  password: { en: 'password', ru: 'пароль', uz: 'parol' },
  name: { en: 'name', ru: 'имя', uz: 'nom' },
  role: { en: 'role', ru: 'роль', uz: 'rol' },
  token: { en: 'token', ru: 'токен', uz: 'token' },
  code: { en: 'code', ru: 'код', uz: 'kod' },
  text: { en: 'text', ru: 'текст', uz: 'matn' },
  message: { en: 'message', ru: 'сообщение', uz: 'xabar' },
  'message text': { en: 'message text', ru: 'текст сообщения', uz: 'xabar matni' },
  status: { en: 'status', ru: 'статус', uz: 'status' },
  file: { en: 'file', ru: 'файл', uz: 'fayl' },
  subject: { en: 'subject', ru: 'тема', uz: 'mavzu' },
  university: { en: 'university', ru: 'университет', uz: 'universitet' },
  user: { en: 'user', ru: 'пользователь', uz: 'foydalanuvchi' },
  scholarship: { en: 'scholarship', ru: 'стипендия', uz: 'stipendiya' },
  document: { en: 'document', ru: 'документ', uz: 'hujjat' },
  faculty: { en: 'faculty', ru: 'факультет', uz: 'fakultet' },
  planId: { en: 'plan', ru: 'план', uz: 'reja' },
  successUrl: { en: 'success URL', ru: 'ссылка успеха', uz: 'muvaffaqiyat havolasi' },
  cancelUrl: { en: 'cancel URL', ru: 'ссылка отмены', uz: 'bekor qilish havolasi' },
  coveragePercent: { en: 'coverage percentage', ru: 'процент покрытия', uz: 'qoplash foizi' },
  maxSlots: { en: 'maximum slots', ru: 'максимум мест', uz: 'maksimal o‘rinlar' },
  universityId: { en: 'university id', ru: 'ID университета', uz: 'universitet IDsi' },
  universityName: { en: 'university name', ru: 'название университета', uz: 'universitet nomi' },
};

const resourceLabels: Record<string, LocalizedText> = {
  user: { en: 'User', ru: 'Пользователь', uz: 'Foydalanuvchi' },
  'student profile': { en: 'Student profile', ru: 'Профиль студента', uz: 'Talaba profili' },
  student: { en: 'Student', ru: 'Студент', uz: 'Talaba' },
  'university profile': { en: 'University profile', ru: 'Профиль университета', uz: 'Universitet profili' },
  university: { en: 'University', ru: 'Университет', uz: 'Universitet' },
  offer: { en: 'Offer', ru: 'Оффер', uz: 'Taklif' },
  interest: { en: 'Interest', ru: 'Интерес', uz: 'Qiziqish' },
  chat: { en: 'Chat', ru: 'Чат', uz: 'Chat' },
  message: { en: 'Message', ru: 'Сообщение', uz: 'Xabar' },
  request: { en: 'Request', ru: 'Запрос', uz: 'So‘rov' },
  investor: { en: 'Investor', ru: 'Инвестор', uz: 'Investor' },
  'landing certificate': { en: 'Landing certificate', ru: 'Сертификат лендинга', uz: 'Landing sertifikati' },
  'catalog university': { en: 'Catalog university', ru: 'Университет из каталога', uz: 'Katalog universiteti' },
  subscription: { en: 'Subscription', ru: 'Подписка', uz: 'Obuna' },
  ticket: { en: 'Ticket', ru: 'Тикет', uz: 'Murojaat' },
  faculty: { en: 'Faculty', ru: 'Факультет', uz: 'Fakultet' },
  notification: { en: 'Notification', ru: 'Уведомление', uz: 'Bildirishnoma' },
  document: { en: 'Document', ru: 'Документ', uz: 'Hujjat' },
  scholarship: { en: 'Scholarship', ru: 'Стипендия', uz: 'Stipendiya' },
  'document template': { en: 'Document template', ru: 'Шаблон документа', uz: 'Hujjat shabloni' },
  invitation: { en: 'Invitation', ru: 'Приглашение', uz: 'Taklifnoma' },
  'offer certificate template': { en: 'Offer certificate template', ru: 'Шаблон оффер-сертификата', uz: 'Taklif sertifikati shabloni' },
};

const exactMessages: Record<string, LocalizedText> = {
  Unauthorized: {
    en: 'Unauthorized',
    ru: 'Требуется авторизация',
    uz: 'Avtorizatsiya talab qilinadi',
  },
  'Authorization required': {
    en: 'Authorization required',
    ru: 'Требуется авторизация',
    uz: 'Avtorizatsiya talab qilinadi',
  },
  'Invalid or expired token': {
    en: 'Invalid or expired token',
    ru: 'Недействительный или просроченный токен',
    uz: 'Token yaroqsiz yoki muddati tugagan',
  },
  'Invalid or expired verification token': {
    en: 'Invalid or expired verification token',
    ru: 'Недействительный или просроченный токен подтверждения',
    uz: 'Tasdiqlash tokeni yaroqsiz yoki muddati tugagan',
  },
  'Invalid or expired reset token': {
    en: 'Invalid or expired reset token',
    ru: 'Недействительный или просроченный токен сброса',
    uz: 'Parolni tiklash tokeni yaroqsiz yoki muddati tugagan',
  },
  'Invalid or expired code': {
    en: 'Invalid or expired code',
    ru: 'Недействительный или просроченный код',
    uz: 'Kod yaroqsiz yoki muddati tugagan',
  },
  'Invalid credentials': {
    en: 'Invalid credentials',
    ru: 'Неверный email или пароль',
    uz: 'Email yoki parol noto‘g‘ri',
  },
  'Invalid refresh token': {
    en: 'Invalid refresh token',
    ru: 'Недействительный refresh token',
    uz: 'Refresh token yaroqsiz',
  },
  'Invalid code': {
    en: 'Invalid code',
    ru: 'Неверный код',
    uz: 'Kod noto‘g‘ri',
  },
  'Email already registered': {
    en: 'Email already registered',
    ru: 'Email уже зарегистрирован',
    uz: 'Email allaqachon ro‘yxatdan o‘tgan',
  },
  'Validation failed': {
    en: 'Validation failed',
    ru: 'Проверьте введённые данные и попробуйте снова',
    uz: 'Kiritilgan ma’lumotlarni tekshirib, qayta urinib ko‘ring',
  },
  'Refresh token required': {
    en: 'Refresh token required',
    ru: 'Требуется refresh token',
    uz: 'Refresh token talab qilinadi',
  },
  'Token required': {
    en: 'Token required',
    ru: 'Требуется токен',
    uz: 'Token talab qilinadi',
  },
  'Code required': {
    en: 'Code required',
    ru: 'Требуется код',
    uz: 'Kod talab qilinadi',
  },
  'Text is required': {
    en: 'Text is required',
    ru: 'Текст обязателен',
    uz: 'Matn kiritilishi shart',
  },
  'Message is required': {
    en: 'Message is required',
    ru: 'Сообщение обязательно',
    uz: 'Xabar kiritilishi shart',
  },
  'Message text is required': {
    en: 'Message text is required',
    ru: 'Текст сообщения обязателен',
    uz: 'Xabar matni kiritilishi shart',
  },
  'Message text is required for text messages': {
    en: 'Message text is required for text messages',
    ru: 'Для текстовых сообщений обязателен текст сообщения',
    uz: 'Matnli xabarlar uchun xabar matni majburiy',
  },
  'Question limit reached (10). Refresh the page to reset it.': {
    en: 'Question limit reached (10). Refresh the page to reset it.',
    ru: 'Лимит вопросов достигнут (10). Обновите страницу, чтобы сбросить счётчик.',
    uz: 'Savollar limiti tugadi (10). Hisoblagichni tiklash uchun sahifani yangilang.',
  },
  'Password must contain at least one uppercase letter': {
    en: 'Password must contain at least one uppercase letter',
    ru: 'Пароль должен содержать хотя бы одну заглавную букву',
    uz: 'Parol kamida bitta katta harfni o‘z ichiga olishi kerak',
  },
  'Password must contain at least one lowercase letter': {
    en: 'Password must contain at least one lowercase letter',
    ru: 'Пароль должен содержать хотя бы одну строчную букву',
    uz: 'Parol kamida bitta kichik harfni o‘z ichiga olishi kerak',
  },
  'Password must contain at least one number': {
    en: 'Password must contain at least one number',
    ru: 'Пароль должен содержать хотя бы одну цифру',
    uz: 'Parol kamida bitta raqamni o‘z ichiga olishi kerak',
  },
  'Status is required': {
    en: 'Status is required',
    ru: 'Статус обязателен',
    uz: 'Status majburiy',
  },
  'Subject and message are required': {
    en: 'Subject and message are required',
    ru: 'Тема и сообщение обязательны',
    uz: 'Mavzu va xabar majburiy',
  },
  'Subscription not found': {
    en: 'Subscription not found',
    ru: 'Подписка не найдена',
    uz: 'Obuna topilmadi',
  },
  'No file uploaded': {
    en: 'No file uploaded',
    ru: 'Файл не загружен',
    uz: 'Fayl yuklanmagan',
  },
  'No file uploaded. Use form field "file" with an .xlsx file.': {
    en: 'No file uploaded. Use form field "file" with an .xlsx file.',
    ru: 'Файл не загружен. Используйте поле формы "file" и загрузите .xlsx файл.',
    uz: 'Fayl yuklanmagan. Forma ichida "file" maydonidan foydalanib .xlsx fayl yuboring.',
  },
  'Site is under maintenance. Please try again later.': {
    en: 'Site is under maintenance. Please try again later.',
    ru: 'Сайт на техническом обслуживании. Попробуйте позже.',
    uz: 'Sayt texnik xizmatda. Keyinroq qayta urinib ko‘ring.',
  },
  'Too many requests': {
    en: 'Too many requests',
    ru: 'Слишком много запросов',
    uz: 'So‘rovlar juda ko‘p',
  },
  'Too many attempts': {
    en: 'Too many attempts',
    ru: 'Слишком много попыток',
    uz: 'Urinishlar juda ko‘p',
  },
  'Too many uploads': {
    en: 'Too many uploads',
    ru: 'Слишком много загрузок',
    uz: 'Yuklashlar juda ko‘p',
  },
  'AI rate limit exceeded': {
    en: 'AI rate limit exceeded',
    ru: 'Превышен лимит запросов к AI',
    uz: 'AI so‘rov limiti oshib ketdi',
  },
  'Request sent': {
    en: 'Request sent',
    ru: 'Запрос отправлен',
    uz: 'So‘rov yuborildi',
  },
  'Already in your school': {
    en: 'Already in your school',
    ru: 'Уже в вашей школе',
    uz: 'Allaqachon sizning maktabingizda',
  },
  'Invitation sent. The student can accept or decline.': {
    en: 'Invitation sent. The student can accept or decline.',
    ru: 'Приглашение отправлено. Студент может принять или отклонить его.',
    uz: 'Taklif yuborildi. Talaba uni qabul qilishi yoki rad etishi mumkin.',
  },
  'Invitation cancelled.': {
    en: 'Invitation cancelled.',
    ru: 'Приглашение отменено.',
    uz: 'Taklif bekor qilindi.',
  },
  'You have joined the school.': {
    en: 'You have joined the school.',
    ru: 'Вы присоединились к школе.',
    uz: 'Siz maktabga qo‘shildingiz.',
  },
  'Invitation declined.': {
    en: 'Invitation declined.',
    ru: 'Приглашение отклонено.',
    uz: 'Taklif rad etildi.',
  },
  'Account suspended. Contact support.': {
    en: 'Account suspended. Contact support.',
    ru: 'Аккаунт заблокирован. Свяжитесь с поддержкой.',
    uz: 'Hisob bloklangan. Qo‘llab-quvvatlashga murojaat qiling.',
  },
  'Please verify your email before signing in.': {
    en: 'Please verify your email before signing in.',
    ru: 'Подтвердите email перед входом.',
    uz: 'Kirishdan oldin emailingizni tasdiqlang.',
  },
  'Your account is pending approval by an administrator.': {
    en: 'Your account is pending approval by an administrator.',
    ru: 'Ваш аккаунт ожидает подтверждения администратором.',
    uz: 'Hisobingiz administrator tasdig‘ini kutmoqda.',
  },
  'Failed to send verification email. Please try again later.': {
    en: 'Failed to send verification email. Please try again later.',
    ru: 'Не удалось отправить письмо с подтверждением. Попробуйте позже.',
    uz: 'Tasdiqlash xatini yuborib bo‘lmadi. Keyinroq urinib ko‘ring.',
  },
  'Failed to send reset email. Please try again later.': {
    en: 'Failed to send reset email. Please try again later.',
    ru: 'Не удалось отправить письмо для сброса пароля. Попробуйте позже.',
    uz: 'Parolni tiklash xatini yuborib bo‘lmadi. Keyinroq urinib ko‘ring.',
  },
  'Password reset is temporarily unavailable. Please contact support.': {
    en: 'Password reset is temporarily unavailable. Please contact support.',
    ru: 'Сброс пароля временно недоступен. Обратитесь в поддержку.',
    uz: 'Parolni tiklash vaqtincha mavjud emas. Qo‘llab-quvvatlashga murojaat qiling.',
  },
  'Insufficient permissions': {
    en: 'Insufficient permissions',
    ru: 'Недостаточно прав',
    uz: 'Huquqlar yetarli emas',
  },
  'Access denied': {
    en: 'Access denied',
    ru: 'Доступ запрещён',
    uz: 'Kirish taqiqlangan',
  },
  'Admin only': {
    en: 'Admin only',
    ru: 'Только для администратора',
    uz: 'Faqat administrator uchun',
  },
  'Not a participant': {
    en: 'Not a participant',
    ru: 'Вы не являетесь участником',
    uz: 'Siz ishtirokchi emassiz',
  },
  'Not your chat': {
    en: 'Not your chat',
    ru: 'Это не ваш чат',
    uz: 'Bu sizning chatingiz emas',
  },
  'Not your document': {
    en: 'Not your document',
    ru: 'Это не ваш документ',
    uz: 'Bu sizning hujjatingiz emas',
  },
  'This chat has been closed by the university': {
    en: 'This chat has been closed by the university',
    ru: 'Этот чат закрыт университетом',
    uz: 'Bu chat universitet tomonidan yopilgan',
  },
  'This account is not a school counsellor': {
    en: 'This account is not a school counsellor',
    ru: 'Этот аккаунт не является школьным консультантом',
    uz: 'Bu hisob maktab maslahatchisi emas',
  },
  'Not a school counsellor': {
    en: 'Not a school counsellor',
    ru: 'Недостаточно прав школьного консультанта',
    uz: 'Maktab maslahatchisi huquqi yo‘q',
  },
  'Only students can request to join a school': {
    en: 'Only students can request to join a school',
    ru: 'Только студенты могут отправлять запрос на присоединение к школе',
    uz: 'Faqat talabalar maktabga qo‘shilish so‘rovini yubora oladi',
  },
  'Only students can be invited to a school': {
    en: 'Only students can be invited to a school',
    ru: 'В школу можно приглашать только студентов',
    uz: 'Maktabga faqat talabalarni taklif qilish mumkin',
  },
  'Only students, universities and school counsellors can create support tickets': {
    en: 'Only students, universities and school counsellors can create support tickets',
    ru: 'Только студенты, университеты и школьные консультанты могут создавать тикеты поддержки',
    uz: 'Faqat talabalar, universitetlar va maktab maslahatchilari yordam murojaatini yaratishi mumkin',
  },
  'Only university can accept students': {
    en: 'Only university can accept students',
    ru: 'Только университет может принимать студентов',
    uz: 'Faqat universitet talabani qabul qila oladi',
  },
  'Student already accepted in this chat': {
    en: 'Student already accepted in this chat',
    ru: 'Студент уже принят в этом чате',
    uz: 'Talaba bu chatda allaqachon qabul qilingan',
  },
  'University profile not found.': {
    en: 'University profile not found.',
    ru: 'Профиль университета не найден.',
    uz: 'Universitet profili topilmadi.',
  },
  'University account must be verified to access this resource': {
    en: 'University account must be verified to access this resource',
    ru: 'Для доступа к этому ресурсу аккаунт университета должен быть подтверждён',
    uz: 'Bu resursga kirish uchun universitet hisobi tasdiqlangan bo‘lishi kerak',
  },
  'Request already sent': {
    en: 'Request already sent',
    ru: 'Запрос уже отправлен',
    uz: 'So‘rov allaqachon yuborilgan',
  },
  'Already in this school': {
    en: 'Already in this school',
    ru: 'Уже в этой школе',
    uz: 'Allaqachon shu maktabda',
  },
  'Request already processed': {
    en: 'Request already processed',
    ru: 'Запрос уже обработан',
    uz: 'So‘rov allaqachon ko‘rib chiqilgan',
  },
  'Invitation already responded to': {
    en: 'Invitation already responded to',
    ru: 'На приглашение уже ответили',
    uz: 'Taklifnomaga allaqachon javob berilgan',
  },
  'Invitation already sent. Waiting for student response.': {
    en: 'Invitation already sent. Waiting for student response.',
    ru: 'Приглашение уже отправлено. Ожидайте ответа студента.',
    uz: 'Taklif allaqachon yuborilgan. Talabaning javobini kuting.',
  },
  'Request already sent for this university': {
    en: 'Request already sent for this university',
    ru: 'Запрос для этого университета уже отправлен',
    uz: 'Bu universitet uchun so‘rov allaqachon yuborilgan',
  },
  'University profile already exists': {
    en: 'University profile already exists',
    ru: 'Профиль университета уже существует',
    uz: 'Universitet profili allaqachon mavjud',
  },
  'Document already reviewed': {
    en: 'Document already reviewed',
    ru: 'Документ уже рассмотрен',
    uz: 'Hujjat allaqachon ko‘rib chiqilgan',
  },
  'Document already processed': {
    en: 'Document already processed',
    ru: 'Документ уже обработан',
    uz: 'Hujjat allaqachon qayta ishlangan',
  },
  'Document is already expired': {
    en: 'Document is already expired',
    ru: 'Срок действия документа уже истёк',
    uz: 'Hujjat muddati allaqachon tugagan',
  },
  'Document can no longer be revoked': {
    en: 'Document can no longer be revoked',
    ru: 'Документ больше нельзя отозвать',
    uz: 'Hujjatni endi bekor qilib bo‘lmaydi',
  },
  'Offer already processed': {
    en: 'Offer already processed',
    ru: 'Оффер уже обработан',
    uz: 'Taklif allaqachon ko‘rib chiqilgan',
  },
  'Offer invalid': {
    en: 'Offer invalid',
    ru: 'Оффер недействителен',
    uz: 'Taklif yaroqsiz',
  },
  'No remaining slots': {
    en: 'No remaining slots',
    ru: 'Свободных мест не осталось',
    uz: 'Bo‘sh o‘rin qolmagan',
  },
  'Cannot delete scholarship with active offers': {
    en: 'Cannot delete scholarship with active offers',
    ru: 'Нельзя удалить стипендию с активными офферами',
    uz: 'Faol takliflari bor stipendiyani o‘chirib bo‘lmaydi',
  },
  'Trial expired. Upgrade to a paid plan to continue sending applications.': {
    en: 'Trial expired. Upgrade to a paid plan to continue sending applications.',
    ru: 'Пробный период закончился. Обновите тариф, чтобы продолжить отправку заявок.',
    uz: 'Sinov muddati tugadi. Ariza yuborishni davom ettirish uchun pullik tarifga o‘ting.',
  },
  'Student profile view limit reached for your current plan': {
    en: 'Student profile view limit reached for your current plan',
    ru: 'Для текущего тарифа достигнут лимит просмотров профилей студентов',
    uz: 'Joriy tarifingiz uchun talaba profillarini ko‘rish limiti tugadi',
  },
  'AI response timeout': {
    en: 'AI response timeout',
    ru: 'AI слишком долго отвечает',
    uz: 'AI javobi uchun vaqt tugadi',
  },
  'AI quota exceeded. Please check your API credits.': {
    en: 'AI quota exceeded. Please check your API credits.',
    ru: 'Квота AI исчерпана. Проверьте API-кредиты.',
    uz: 'AI kvotasi tugadi. API kreditlaringizni tekshiring.',
  },
  'AI API key is missing or invalid.': {
    en: 'AI API key is missing or invalid.',
    ru: 'AI API-ключ отсутствует или недействителен.',
    uz: 'AI API kaliti yo‘q yoki yaroqsiz.',
  },
  'AI rate limit exceeded. Try again later.': {
    en: 'AI rate limit exceeded. Try again later.',
    ru: 'Превышен лимит запросов к AI. Попробуйте позже.',
    uz: 'AI so‘rov limiti oshib ketdi. Keyinroq urinib ko‘ring.',
  },
  'AI service unreachable. Check server network.': {
    en: 'AI service unreachable. Check server network.',
    ru: 'AI-сервис недоступен. Проверьте сеть сервера.',
    uz: 'AI xizmati bilan bog‘lanib bo‘lmadi. Server tarmog‘ini tekshiring.',
  },
  'Internal server error': {
    en: 'Internal server error',
    ru: 'Внутренняя ошибка сервера',
    uz: 'Ichki server xatosi',
  },
  'Invalid id format': {
    en: 'Invalid id format',
    ru: 'Неверный формат ID',
    uz: 'ID formati noto‘g‘ri',
  },
  'Invalid url': {
    en: 'Invalid URL',
    ru: 'Неверная ссылка',
    uz: 'URL noto‘g‘ri',
  },
  'You must accept the terms': {
    en: 'You must accept the terms',
    ru: 'Необходимо принять условия',
    uz: 'Shartlarni qabul qilishingiz kerak',
  },
  'Failed to send message': {
    en: 'Failed to send message',
    ru: 'Не удалось отправить сообщение',
    uz: 'Xabarni yuborib bo‘lmadi',
  },
  'User not found or suspended': {
    en: 'User not found or suspended',
    ru: 'Пользователь не найден или заблокирован',
    uz: 'Foydalanuvchi topilmadi yoki bloklangan',
  },
  'Database not connected': {
    en: 'Database not connected',
    ru: 'База данных недоступна',
    uz: 'Ma’lumotlar bazasi ulanmagan',
  },
  'Chat has no university': {
    en: 'Chat has no university',
    ru: 'Чат не связан с университетом',
    uz: 'Chat universitet bilan bog‘lanmagan',
  },
  'Cannot modify default admin': {
    en: 'Cannot modify default admin',
    ru: 'Нельзя изменять основного администратора',
    uz: 'Standart administratorni o‘zgartirib bo‘lmaydi',
  },
  'Cannot change default admin role': {
    en: 'Cannot change default admin role',
    ru: 'Нельзя изменить роль основного администратора',
    uz: 'Standart administrator rolini o‘zgartirib bo‘lmaydi',
  },
  'Cannot suspend default admin': {
    en: 'Cannot suspend default admin',
    ru: 'Нельзя заблокировать основного администратора',
    uz: 'Standart administratorni bloklab bo‘lmaydi',
  },
  'Cannot suspend admin': {
    en: 'Cannot suspend admin',
    ru: 'Нельзя заблокировать администратора',
    uz: 'Administratorni bloklab bo‘lmaydi',
  },
  'Cannot reset default admin password': {
    en: 'Cannot reset default admin password',
    ru: 'Нельзя сбросить пароль основного администратора',
    uz: 'Standart administrator parolini tiklab bo‘lmaydi',
  },
  'Cannot delete default admin': {
    en: 'Cannot delete default admin',
    ru: 'Нельзя удалить основного администратора',
    uz: 'Standart administratorni o‘chirib bo‘lmaydi',
  },
  'Cannot delete admin users': {
    en: 'Cannot delete admin users',
    ru: 'Нельзя удалять администраторов',
    uz: 'Administrator foydalanuvchilarini o‘chirib bo‘lmaydi',
  },
  'University no longer available': {
    en: 'University no longer available',
    ru: 'Этот университет больше недоступен',
    uz: 'Universitet endi mavjud emas',
  },
  'Invalid page format': {
    en: 'Invalid page format',
    ru: 'Неверный формат страницы',
    uz: 'Sahifa formati noto‘g‘ri',
  },
  'Invalid document type': {
    en: 'Invalid document type',
    ru: 'Неверный тип документа',
    uz: 'Hujjat turi noto‘g‘ri',
  },
  'Invalid document source': {
    en: 'Invalid document source',
    ru: 'Неверный источник документа',
    uz: 'Hujjat manbasi noto‘g‘ri',
  },
  'Invalid accept deadline': {
    en: 'Invalid accept deadline',
    ru: 'Неверный срок принятия',
    uz: 'Qabul qilish muddati noto‘g‘ri',
  },
  'Accept deadline must be in the future': {
    en: 'Accept deadline must be in the future',
    ru: 'Срок принятия должен быть в будущем',
    uz: 'Qabul qilish muddati kelajakdagi sana bo‘lishi kerak',
  },
  'fileUrl is required for uploaded documents': {
    en: 'file URL is required for uploaded documents',
    ru: 'Для загруженных документов обязателен URL файла',
    uz: 'Yuklangan hujjatlar uchun fayl URLi majburiy',
  },
  'canvasJson is required for editor documents': {
    en: 'document layout is required for editor documents',
    ru: 'Для документов из редактора обязателен макет',
    uz: 'Editor hujjatlari uchun hujjat maketi majburiy',
  },
  'Template type does not match the requested document type': {
    en: 'Template type does not match the requested document type',
    ru: 'Тип шаблона не совпадает с запрошенным типом документа',
    uz: 'Shablon turi so‘ralgan hujjat turiga mos emas',
  },
  'Chat does not match selected student': {
    en: 'Chat does not match selected student',
    ru: 'Чат не соответствует выбранному студенту',
    uz: 'Chat tanlangan talabaga mos emas',
  },
  '2FA not set up. Call setup first.': {
    en: '2FA not set up. Call setup first.',
    ru: 'Двухфакторная защита не настроена. Сначала выполните настройку.',
    uz: '2FA hali sozlanmagan. Avval uni sozlang.',
  },
  'Invalid role for subscription': {
    en: 'Invalid role for subscription',
    ru: 'Неверная роль для подписки',
    uz: 'Obuna uchun rol noto‘g‘ri',
  },
  'Edmission API': {
    en: 'Edmission API',
    ru: 'Edmission API',
    uz: 'Edmission API',
  },
};

const regexMessages: Array<{ pattern: RegExp; handler: RegexHandler }> = [
  {
    pattern: /^Please wait (\d+) seconds before resending$/,
    handler: (match, locale) => {
      const seconds = match[1];
      if (locale === 'ru') return `Подождите ${seconds} сек. перед повторной отправкой`;
      if (locale === 'uz') return `Qayta yuborishdan oldin ${seconds} soniya kuting`;
      return `Please wait ${seconds} seconds before resending`;
    },
  },
  {
    pattern: /^Application limit reached \(([^)]+)\)\. Upgrade your plan to send more\.$/,
    handler: (match, locale) => {
      const usage = match[1];
      if (locale === 'ru') return `Достигнут лимит заявок (${usage}). Обновите тариф, чтобы отправлять больше.`;
      if (locale === 'uz') return `Ariza limiti tugadi (${usage}). Ko‘proq yuborish uchun tarifni yangilang.`;
      return `Application limit reached (${usage}). Upgrade your plan to send more.`;
    },
  },
  {
    pattern: /^Student request limit reached \(([^)]+)\)\. Upgrade to Premium for unlimited requests\.$/,
    handler: (match, locale) => {
      const usage = match[1];
      if (locale === 'ru') return `Достигнут лимит запросов к студентам (${usage}). Перейдите на Premium для безлимитных запросов.`;
      if (locale === 'uz') return `Talaba so‘rovlari limiti tugadi (${usage}). Cheksiz so‘rovlar uchun Premiumga o‘ting.`;
      return `Student request limit reached (${usage}). Upgrade to Premium for unlimited requests.`;
    },
  },
  {
    pattern: /^AI service unavailable: (.+)$/,
    handler: (match, locale) => {
      const detail = match[1];
      if (locale === 'ru') return `AI-сервис временно недоступен: ${detail}`;
      if (locale === 'uz') return `AI xizmati vaqtincha mavjud emas: ${detail}`;
      return `AI service unavailable: ${detail}`;
    },
  },
  {
    pattern: /^Invalid (.+)$/,
    handler: (match, locale) => {
      const field = translateLabel(fieldLabels, match[1], locale);
      if (locale === 'ru') return `Некорректное значение: ${field}`;
      if (locale === 'uz') return `Noto‘g‘ri qiymat: ${field}`;
      return `Invalid ${field}`;
    },
  },
  {
    pattern: /^(.+) is required$/,
    handler: (match, locale) => {
      const field = translateLabel(fieldLabels, match[1], locale);
      if (locale === 'ru') return `Поле «${field}» обязательно`;
      if (locale === 'uz') return `“${field}” maydoni majburiy`;
      return `${field} is required`;
    },
  },
  {
    pattern: /^(.+) not found$/,
    handler: (match, locale) => {
      const resource = translateLabel(resourceLabels, match[1], locale);
      if (locale === 'ru') return `${resource} не найден`;
      if (locale === 'uz') return `${resource} topilmadi`;
      return `${resource} not found`;
    },
  },
  {
    pattern: /^Invalid (.+) format$/,
    handler: (match, locale) => {
      const field = translateLabel(fieldLabels, match[1], locale);
      if (locale === 'ru') return `Неверный формат: ${field}`;
      if (locale === 'uz') return `${field} formati noto‘g‘ri`;
      return `Invalid ${field} format`;
    },
  },
  {
    pattern: /^(.+), (.+) and (.+) are required$/,
    handler: (match, locale) => {
      const first = translateLabel(fieldLabels, match[1], locale);
      const second = translateLabel(fieldLabels, match[2], locale);
      const third = translateLabel(fieldLabels, match[3], locale);
      if (locale === 'ru') return `Поля «${first}», «${second}» и «${third}» обязательны`;
      if (locale === 'uz') return `“${first}”, “${second}” va “${third}” maydonlari majburiy`;
      return `${first}, ${second} and ${third} are required`;
    },
  },
  {
    pattern: /^(.+) or (.+) required$/,
    handler: (match, locale) => {
      const first = translateLabel(fieldLabels, match[1], locale);
      const second = translateLabel(fieldLabels, match[2], locale);
      if (locale === 'ru') return `Требуется ${first} или ${second}`;
      if (locale === 'uz') return `${first} yoki ${second} majburiy`;
      return `${first} or ${second} required`;
    },
  },
  {
    pattern: /^(.+) name is required$/,
    handler: (match, locale) => {
      const field = match[1];
      if (locale === 'ru') return `Название «${field}» обязательно`;
      if (locale === 'uz') return `${field} nomi majburiy`;
      return `${field} name is required`;
    },
  },
  {
    pattern: /^(.+) description is required$/,
    handler: (match, locale) => {
      const field = match[1];
      if (locale === 'ru') return `Описание «${field}» обязательно`;
      if (locale === 'uz') return `${field} tavsifi majburiy`;
      return `${field} description is required`;
    },
  },
  {
    pattern: /^Provide (\d+)-(\d+) university ids$/,
    handler: (match, locale) => {
      const min = match[1];
      const max = match[2];
      if (locale === 'ru') return `Укажите от ${min} до ${max} ID университетов`;
      if (locale === 'uz') return `${min} dan ${max} gacha universitet ID sini kiriting`;
      return `Provide ${min}-${max} university ids`;
    },
  },
  {
    pattern: /^(.+) must be approved or rejected$/,
    handler: (match, locale) => {
      const field = translateLabel(fieldLabels, match[1], locale);
      if (locale === 'ru') return `Поле «${field}» должно быть approved или rejected`;
      if (locale === 'uz') return `“${field}” maydoni approved yoki rejected bo‘lishi kerak`;
      return `${field} must be approved or rejected`;
    },
  },
  {
    pattern: /^Failed to send (.+)$/,
    handler: (match, locale) => {
      const target = match[1];
      if (locale === 'ru') return `Не удалось отправить ${target}`;
      if (locale === 'uz') return `${target} ni yuborib bo‘lmadi`;
      return `Failed to send ${target}`;
    },
  },
  {
    pattern: /^Required$/,
    handler: (_match, locale) => {
      if (locale === 'ru') return 'Обязательное поле';
      if (locale === 'uz') return 'Majburiy maydon';
      return 'Required';
    },
  },
  {
    pattern: /^Invalid email$/,
    handler: (_match, locale) => {
      if (locale === 'ru') return 'Введите корректный email';
      if (locale === 'uz') return 'To‘g‘ri email kiriting';
      return 'Invalid email';
    },
  },
  {
    pattern: /^String must contain at least (\d+) character\(s\)$/,
    handler: (match, locale) => {
      const count = match[1];
      if (locale === 'ru') return `Строка должна содержать минимум ${count} символов`;
      if (locale === 'uz') return `Matnda kamida ${count} ta belgi bo‘lishi kerak`;
      return `String must contain at least ${count} character(s)`;
    },
  },
];

function translateLabel(
  dictionary: Record<string, LocalizedText>,
  value: string,
  locale: ApiLocale
): string {
  const normalized = value.trim();
  return dictionary[normalized]?.[locale] ?? normalized;
}

function normalizeLanguageToken(value: string): string {
  return value.trim().toLowerCase().split('-')[0];
}

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((entry) => {
      const [rawLang, ...rest] = entry.trim().split(';');
      const qPart = rest.find((part) => part.trim().startsWith('q='));
      const q = qPart ? Number(qPart.trim().slice(2)) : 1;
      return {
        lang: normalizeLanguageToken(rawLang),
        q: Number.isFinite(q) ? q : 0,
      };
    })
    .filter((entry) => entry.lang.length > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.lang);
}

function tryFixMojibake(input: string): string {
  // Typical UTF-8 text accidentally decoded as Latin-1 (e.g. "РџРѕ...")
  if (!/(Р.|Ð.|Ñ.)/.test(input)) return input;
  try {
    const repaired = Buffer.from(input, 'latin1').toString('utf8').trim();
    return repaired && !/(�)/.test(repaired) ? repaired : input;
  } catch {
    return input;
  }
}

export function resolveApiLocale(value: unknown): ApiLocale {
  const input = String(value ?? '').toLowerCase();
  if (!input) return 'en';

  const preferred = parseAcceptLanguage(input);
  for (const lang of preferred) {
    if (lang === 'ru') return 'ru';
    if (lang === 'uz') return 'uz';
    if (lang === 'en') return 'en';
  }

  if (input.includes('ru')) return 'ru';
  if (input.includes('uz')) return 'uz';
  return 'en';
}

export function translateApiText(message: string, locale: ApiLocale): TranslationResult {
  const normalized = tryFixMojibake(String(message ?? '').trim());
  if (!normalized) return { text: normalized };

  const exact = exactMessages[normalized];
  if (exact) {
    return { text: exact[locale] };
  }

  for (const entry of regexMessages) {
    const match = normalized.match(entry.pattern);
    if (match) {
      return { text: entry.handler(match, locale) };
    }
  }

  return { text: normalized };
}

export function localizeApiBody<T>(body: T, locale: ApiLocale): T {
  const visit = (value: unknown, shouldTranslate = false): unknown => {
    if (typeof value === 'string') {
      return shouldTranslate ? translateApiText(value, locale).text : value;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, shouldTranslate));
    if (!value || typeof value !== 'object') return value;

    const next: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, nested] of Object.entries(next)) {
      const translateCurrent = shouldTranslate || key === 'message' || key === 'error' || key === 'title' || key === 'body';
      if (key === 'errors' && Array.isArray(nested)) {
        next[key] = nested.map((entry) => visit(entry, true));
      } else {
        next[key] = visit(nested, translateCurrent);
      }
    }
    return next;
  };

  return visit(body) as T;
}
