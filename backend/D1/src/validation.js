export function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('资料必须是对象')
  for (const [key,max] of [['nickname',50],['email',100],['phone',20]]) {
    const value=body[key]
    if (value !== undefined && value !== null && (typeof value !== 'string' || [...value].length>max)) throw invalid(`${key} 格式或长度无效`)
  }
  if(body.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.email)) throw invalid('邮箱地址格式无效')
}
export function validateCredentials(body, registration=false) {
  if (!body || typeof body.username !== 'string' || !body.username.trim() || [...body.username].length>50 ||
      typeof body.password !== 'string' || !body.password) throw invalid('用户名和密码格式无效')
  if (registration) {
    if(Buffer.byteLength(body.password,'utf8')>72) throw invalid('密码不能超过72个UTF-8字节')
    validateProfile(body)
    if(body.college_id != null && (typeof body.college_id !== 'string' || !/^[1-9]\d{0,18}$/.test(body.college_id) || BigInt(body.college_id)>9223372036854775807n)) throw invalid('学院编号无效')
  }
}
const invalid=message=>Object.assign(new Error(message),{status:400})
