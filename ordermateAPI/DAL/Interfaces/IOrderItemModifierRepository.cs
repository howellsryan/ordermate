using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IOrderItemModifierRepository
{
    Task<IEnumerable<OrderItemModifierModel>> GetAllByOrderItemId(int orderItemId);
    Task<IEnumerable<OrderItemModifierModel>> GetAllByOrderId(int orderId);
}