"""Exercise the real deployment script; Docker is a controlled external boundary."""
import unittest,tempfile,pathlib,subprocess,os,json,tarfile,io,hashlib
SCRIPT=pathlib.Path(__file__).with_name('server-release.sh').resolve()
class Releases(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name).resolve(); self.bin=self.root/'bin'; self.bin.mkdir()
  for name,body in {'flock':'exit 0','docker':'echo "$*" >> "$LAB1_ROOT/docker.calls"; case " $* " in *" up "*) exit "${DOCKER_EXIT:-0}";; esac; exit 0'}.items():
   p=self.bin/name;p.write_text('#!/bin/sh\n'+body+'\n');p.chmod(0o700)
  self.env={**os.environ,'LAB1_ROOT':str(self.root),'PATH':str(self.bin)+':'+os.environ['PATH']}
  (self.root/'shared').mkdir();(self.root/'shared/.env').write_text('')
 def tearDown(self): self.tmp.cleanup()
 def release(self,char,schema='same'):
  version=char*40+'-1-1';p=self.root/'releases'/version;p.mkdir(parents=True)
  (p/'release.json').write_text(json.dumps({'release':version,'schema':schema}));(p/'compose.json').write_text('{}');(p/'server-release.sh').write_text(SCRIPT.read_text());return p
 def run_script(self,*args): return subprocess.run(['bash',str(SCRIPT),*args],env=self.env,capture_output=True,text=True)
 def test_no_current_is_not_success(self): self.assertNotEqual(self.run_script('status').returncode,0)
 def test_invalid_rollback_id_rejected(self): self.assertNotEqual(self.run_script('rollback','../shared').returncode,0)
 def test_schema_change_blocks_rollback_before_docker(self):
  a=self.release('a');b=self.release('b','different');(self.root/'current').symlink_to(a)
  self.assertNotEqual(self.run_script('rollback',b.name).returncode,0);self.assertFalse((self.root/'docker.calls').exists());self.assertEqual((self.root/'current').resolve(),a)
 def test_unhealthy_rollback_does_not_advance_success_pointer(self):
  a=self.release('a');b=self.release('b');(self.root/'current').symlink_to(a);self.env['DOCKER_EXIT']='1'
  self.assertNotEqual(self.run_script('rollback',b.name).returncode,0);self.assertEqual((self.root/'current').resolve(),a)
 def test_compatible_rollback_changes_version_and_records_history(self):
  a=self.release('a');b=self.release('b');(self.root/'current').symlink_to(a)
  result=self.run_script('rollback',b.name);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual((self.root/'current').resolve(),b);self.assertEqual((self.root/'previous').resolve(),a)
  record=json.loads((self.root/'deployments.jsonl').read_text());self.assertEqual(record['action'],'rollback');self.assertEqual(record['release'],b.name)
 def test_rollback_preserves_current_release_controller(self):
  a=self.release('a');b=self.release('b');(self.root/'current').symlink_to(a)
  controller=self.root/'server-release.sh';controller.write_text('new controller')
  result=self.run_script('rollback',b.name)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(controller.read_text(),'new controller')
 def archive(self, members):
  archive=self.root/'release.tar.gz'
  with tarfile.open(archive,'w:gz') as t:
   for name,body,kind in members:
    m=tarfile.TarInfo(name);m.type=kind
    if kind==tarfile.REGTYPE:
     m.size=len(body);t.addfile(m,io.BytesIO(body))
    else:
     m.linkname='outside';t.addfile(m)
  digest=hashlib.sha256(archive.read_bytes()).hexdigest()
  pathlib.Path(str(archive)+'.sha256').write_text(digest+'  '+archive.name+'\n')
  return archive
 def test_streamed_deploy_extracts_and_records_success(self):
  version='c'*40+'-1-1'
  files={'release.json':json.dumps({'release':version,'schema':'same'}).encode(),
         'compose.json':b'{}','server-release.sh':SCRIPT.read_bytes(),
         'db/init/seed.sql':b'SELECT 1;', 'images.tar':b'image data'*10000}
  archive=self.archive([(name,body,tarfile.REGTYPE) for name,body in files.items()])
  result=self.run_script('deploy',str(archive))
  self.assertEqual(result.returncode,0,result.stderr)
  next=self.root/'releases'/version
  self.assertEqual((self.root/'current').resolve(),next)
  for name,body in files.items():self.assertEqual((next/name).read_bytes(),body)
  self.assertIn('发布包解压',result.stdout)
  self.assertIn('服务 frontend 就绪',result.stdout)
 def test_unsafe_late_archive_member_cleans_stage_without_starting_services(self):
  for name,kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),
                    ('link',tarfile.SYMTYPE),('hardlink',tarfile.LNKTYPE),('pipe',tarfile.FIFOTYPE)]:
   with self.subTest(name=name):
    archive=self.archive([('safe',b'partial extraction',tarfile.REGTYPE),(name,b'bad',kind)])
    result=self.run_script('deploy',str(archive))
    self.assertNotEqual(result.returncode,0)
    self.assertIn('非法归档成员',result.stderr)
    self.assertEqual(list((self.root/'releases').iterdir()),[])
    self.assertFalse((self.root/'docker.calls').exists())
    self.assertFalse((self.root/'current').exists())
    self.assertFalse((self.root/'releases'/'escape').exists())
if __name__=='__main__':unittest.main()
