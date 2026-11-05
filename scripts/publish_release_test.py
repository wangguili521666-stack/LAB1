import importlib.util,json,pathlib,unittest
spec=importlib.util.spec_from_file_location('publish',pathlib.Path(__file__).with_name('publish-release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Publication(unittest.TestCase):
 def setUp(self):
  self.meta={'revision':'a'*40,'release':'a'*40+'-42-1','run':'42','attempt':'1','schema':'b'*64}
  self.run={'head_sha':'a'*40,'head_branch':'main','conclusion':'success','path':'.github/workflows/ci.yml','event':'push','run_attempt':1}
  self.calls=[];self.refs=[];self.releases=[[]]
 def gh(self,args):
  self.calls.append(args)
  if 'actions/runs/42' in args[1]:return json.dumps(self.run)
  if 'matching-refs' in args[1]:return json.dumps(self.refs)
  if '--slurp' in args:return json.dumps(self.releases)
  return '{}'
 def test_success_creates_tag_at_artifact_sha_and_release_notes(self):
  tag=m.publish(self.meta,'owner/repo',self.gh)
  self.assertTrue(any('sha='+self.meta['revision'] in c for c in self.calls))
  self.assertTrue(any(c[:3]==['release','create',tag] and '--generate-notes' in c for c in self.calls))
 def test_wrong_or_failed_ci_cannot_publish(self):
  for key,value in [('head_sha','c'*40),('conclusion','failure'),('head_branch','feature'),('run_attempt',2)]:
   old=self.run[key];self.run[key]=value;self.calls=[]
   with self.assertRaises(ValueError):m.publish(self.meta,'owner/repo',self.gh)
   self.assertEqual(len(self.calls),1);self.run[key]=old
 def test_existing_wrong_tag_is_never_moved(self):
  self.refs=[{'ref':'refs/tags/prod-'+self.meta['release'],'object':{'type':'commit','sha':'c'*40}}]
  with self.assertRaises(ValueError):m.publish(self.meta,'owner/repo',self.gh)
  self.assertFalse(any('--method' in c or c[0]=='release' for c in self.calls))
 def test_repeat_does_not_duplicate_release(self):
  tag='prod-'+self.meta['release'];self.refs=[{'ref':'refs/tags/'+tag,'object':{'type':'commit','sha':self.meta['revision']}}];self.releases=[[{'tag_name':tag}]]
  self.assertEqual(m.publish(self.meta,'owner/repo',self.gh),tag)
  self.assertFalse(any('--method' in c or c[0]=='release' for c in self.calls))
if __name__=='__main__':unittest.main()
