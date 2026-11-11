// 加密保存的东西：DeepSeek Key、各平台的连接令牌。用系统的加密（Electron safeStorage），
// 存在 settings.json 的 secrets 字段里；系统不支持加密时退回明文（和以前保存 Key 的规则一样）。
// 界面永远拿不到明文：要复制令牌时由主进程直接写进剪贴板。

/**
 * @param {object} deps
 * @param {{load:(name:string, fallback:any)=>any, save:(name:string, data:any)=>void}} deps.store
 * @param {{available:()=>Promise<boolean>, encrypt:(s:string)=>Promise<Buffer>, decrypt:(b:Buffer)=>Promise<{result:string, shouldReEncrypt?:boolean}>}} deps.cipher
 */
function createSecrets({ store, cipher }) {
  const raw = () => store.load('settings', {});

  async function encode(value) {
    if (await cipher.available()) return { enc: (await cipher.encrypt(value)).toString('base64') };
    return { plain: value };
  }

  /** 旧版本把 DeepSeek Key 直接放在 apiKeyEnc / apiKeyPlain 里，读的时候兼容 */
  function entryOf(s, name) {
    const e = s.secrets?.[name];
    if (e) return e;
    if (name === 'deepseek') {
      if (s.apiKeyEnc) return { enc: s.apiKeyEnc, legacy: true };
      if (s.apiKeyPlain) return { plain: s.apiKeyPlain, legacy: true };
    }
    return null;
  }

  return {
    async save(name, value) {
      const s = raw();
      s.secrets = { ...(s.secrets || {}) };
      if (value == null || value === '') delete s.secrets[name];
      else s.secrets[name] = await encode(String(value));
      if (name === 'deepseek') { delete s.apiKeyEnc; delete s.apiKeyPlain; }
      store.save('settings', s);
    },

    async read(name) {
      const s = raw();
      const e = entryOf(s, name);
      if (!e) return '';
      if (e.plain != null) return e.plain;
      if (!(await cipher.available())) return '';
      try {
        const { result, shouldReEncrypt } = await cipher.decrypt(Buffer.from(e.enc, 'base64'));
        // 系统换了加密方式、或者还是旧字段：重新加密存成新格式
        if (result && (shouldReEncrypt || e.legacy)) await this.save(name, result);
        return result || '';
      } catch {
        return '';
      }
    },

    has(name) {
      return !!entryOf(raw(), name);
    },
  };
}

/** Electron safeStorage 的异步接口包成上面要的样子 */
function electronCipher(safeStorage) {
  return {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptStringAsync(s),
    decrypt: (b) => safeStorage.decryptStringAsync(b),
  };
}

module.exports = { createSecrets, electronCipher };
