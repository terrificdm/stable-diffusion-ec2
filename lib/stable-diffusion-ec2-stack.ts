import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export class StableDiffusionEc2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {isDefault: true});
    
    const ubuntuLinux = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
      { os: ec2.OperatingSystemType.LINUX }
      );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'apt-get update -y',
      'apt install gcc -y',
      `distribution=$(. /etc/os-release;echo $ID$VERSION_ID | sed -e 's/\\.//g')`,
      'wget https://developer.download.nvidia.com/compute/cuda/repos/$distribution/x86_64/cuda-keyring_1.0-1_all.deb',
      'dpkg -i cuda-keyring_1.0-1_all.deb',
      'apt-get update -y',
      'apt-get -y install cuda-drivers',
      'apt install wget git python3 python3-venv libgl1 libglib2.0-0 -y',
      'apt install --no-install-recommends google-perftools -y',
      'apt install python3-pip -y',
      'wget -q https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui/master/webui.sh -P /home/ubuntu',
      'cd /home/ubuntu',
      `su ubuntu -c 'bash webui.sh --xformers --exit'`,
      `su ubuntu -c 'nohup bash webui.sh --xformers --listen  --port 8080 --gradio-auth admin:123456 > ./sd-webui.log 2>&1 &'`, // Change username & password to yours through -gradio-auth admin:123456
      );
    
    const keyPair = "sd-key-pair.pem";
    const keyName = keyPair.split(".")[0];
    const cfnKeyPair = new ec2.CfnKeyPair(this, 'CfnKeyPair', {
      keyName: keyName,
    })
    cfnKeyPair.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)
    
    const instance = new ec2.Instance(this, 'Instance', {
      vpc: vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.G5, ec2.InstanceSize.XLARGE2),
      machineImage: ubuntuLinux,
      blockDevices: [{
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(500)
      }],
      userData: userData,
      keyName: cdk.Token.asString(cfnKeyPair.ref),
    });
    
    instance.connections.allowFromAnyIpv4(ec2.Port.tcp(22), 'Allow ssh from internet');
    instance.connections.allowFromAnyIpv4(ec2.Port.tcp(443), 'Allow https from internet'); // if you don't want to enable "share" flag for directly public access, comment this line out.
    instance.connections.allowFromAnyIpv4(ec2.Port.tcp(8080), 'Allow access port 8080 from internet'); 
    
    new cdk.CfnOutput(this, 'InstanceConsole', {
      value: 'https://console.aws.amazon.com/ec2/home?region='+instance.env.region+'#Instances:search='+instance.instanceId,
      description: 'The AWS console for webui EC2 instance'
    });
    new cdk.CfnOutput(this, 'GetSSHKeyCommand', {
      value: `aws ssm get-parameter --name /ec2/keypair/${cfnKeyPair.getAtt('KeyPairId')} --region ${this.region} --with-decryption --query Parameter.Value --output text > ${keyPair} && chmod 400 ${keyPair}`,
      description: 'The private key for ssh access EC2 instance'
    })
    new cdk.CfnOutput(this, 'SDWebUIPotal', {
      value: instance.instancePublicDnsName+':8080',
      description: 'SD-WebUI access endpoint, default user/passwd is admin/123456'
    })
  }
}