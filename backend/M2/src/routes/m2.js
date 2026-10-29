import { Router } from 'express'
import { authRequired, requestMeta } from '../middleware/auth.js'
import { ok } from '../utils/response.js'
import * as applications from '../services/applications.js'

const router = Router()

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

router.use(authRequired)

router.get('/classrooms', wrap(async (req, res) => {
  res.json(ok(await applications.searchClassrooms(req.query)))
}))

router.post('/applications', wrap(async (req, res) => {
  const created = await applications.createApplication(req.user.id, req.body, requestMeta(req))
  res.status(201).json(ok(created))
}))

router.get('/applications/me', wrap(async (req, res) => {
  res.json(ok(await applications.listMine(req.user.id, req.query)))
}))

router.get('/approvals/pending', wrap(async (req, res) => {
  res.json(ok(await applications.listPending(req.user.id, req.query)))
}))

router.get('/admin/applications', wrap(async (req, res) => {
  res.json(ok(await applications.listAdmin(req.user.id, req.query)))
}))

router.get('/applications/:id', wrap(async (req, res) => {
  res.json(ok(await applications.getApplication(req.user.id, req.params.id)))
}))

router.get('/applications/:id/approvals', wrap(async (req, res) => {
  res.json(ok(await applications.listApprovals(req.user.id, req.params.id)))
}))

router.post('/applications/:id/cancel', wrap(async (req, res) => {
  res.json(ok(await applications.cancelApplication(req.user.id, req.params.id, requestMeta(req))))
}))

router.post('/applications/:id/approve', wrap(async (req, res) => {
  res.json(ok(await applications.decide(req.user.id, req.params.id, 'APPROVED', req.body?.comment, requestMeta(req))))
}))

router.post('/applications/:id/reject', wrap(async (req, res) => {
  res.json(ok(await applications.decide(req.user.id, req.params.id, 'REJECTED', req.body?.comment, requestMeta(req))))
}))

export default router
