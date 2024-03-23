using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IOrderItemRepository
{
    Task<OrderItemModel?> Get(int orderItemId);
    Task<OrderItemModel?> Get(int orderId, int productOptionId, List<ordermateAPI.Models.AddOrderItemModel.OrderItemModifier> modifiers);
    Task AddItem(ordermateAPI.Models.AddOrderItemModel addOrderItem);
    Task UpdateItemAndModifiers(ordermateAPI.Models.AddOrderItemModel addOrderItem, List<OrderItemModifierModel> existingModifiers);
    Task UpdateItem(ordermateAPI.Models.AddOrderItemModel addOrderItem);
    Task RemoveItem(int orderItemId);
    Task<IEnumerable<OrderItemModel>> GetAllOrderItemsByOrderId(int orderId);
}