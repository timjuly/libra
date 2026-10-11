import { Check } from 'lucide-react';
import { Button, Message } from '../components/ui';
import { Modal } from '../components/Modal';

export function Help({ close }: { close: () => void }) {
  return (
    <Modal title="连接，其实很简单" subtitle="从服务器到播放器，三步就好。" close={close}>
      <div className="modal-body">
        <div className="help-step">
          <span>01</span>
          <div>
            <h3>整理你的服务器</h3>
            <p>添加 Emby 地址、账号和备用线路。密码会原样保留，重复的线路会自动合并。</p>
          </div>
        </div>
        <div className="help-step">
          <span>02</span>
          <div>
            <h3>打开喜欢的播放器</h3>
            <p>
              在服务器卡片点击「导入播放器」，选择已安装的应用。Libra 支持完整 v1
              配置，其余应用按各自的协议生成链接。
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>03</span>
          <div>
            <h3>让配置跟随你</h3>
            <p>创建订阅链接，交给支持此 JSON 接口的客户端。以后修改服务器，客户端再次拉取即可获得更新。</p>
          </div>
        </div>
        <Message>
          公开订阅地址是一把读取配置的钥匙。请妥善保管；停用、删除或更换后缀后，边缘节点同步可能需要一分钟或更久，客户端已保存的数据不会被远程删除。
        </Message>
        <p className="field-note">
          本工具与同名 Libra 播放器是独立项目。导入仅生成配置链接，不检测服务器连通性。
        </p>
      </div>
      <div className="modal-footer">
        <Button onClick={close}>
          明白了
          <Check size={16} />
        </Button>
      </div>
    </Modal>
  );
}
